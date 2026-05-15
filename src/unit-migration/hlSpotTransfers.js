# /* ============================================================
hlSpotTransfers.js — User-signed HL transfer actions

These are the actions an HL agent wallet CANNOT sign — they
require the master (HL-derived) wallet:

- usdClassTransfer: move USDC between spot and perp wallets
- spotSend:         send a spot token (e.g. uSOL) to an address
  on HL. Used to push uSOL to the Unit-generated
  withdraw address.

Both use EIP-712 typed data signing with the
“HyperliquidSignTransaction” domain.

============================================================ */

import {
getEthers,
getEthersNs,
signTypedDataCompat,
splitSigCompat,
nextNonce,
} from ‘./hlAgentWallet.js’;

// —– usdClassTransfer —–

/**

- Sign a usdClassTransfer action (perp ↔ spot transfer).
- 
- @param {string}  masterPrivateKey
- @param {object}  action - {
- type: ‘usdClassTransfer’,
- hyperliquidChain: ‘Mainnet’,
- signatureChainId: ‘0xa4b1’,
- amount: ‘5.00’,        // string, USDC with up to 6 decimals
- toPerp: true | false,  // direction
- nonce: <ms>,
- }
  */
  export async function signUsdClassTransfer(masterPrivateKey, action) {
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(masterPrivateKey);
  const domain = {
  name: ‘HyperliquidSignTransaction’, version: ‘1’,
  chainId: 42161,
  verifyingContract: ‘0x0000000000000000000000000000000000000000’,
  };
  const types = {
  ‘HyperliquidTransaction:UsdClassTransfer’: [
  { name: ‘hyperliquidChain’, type: ‘string’ },
  { name: ‘amount’,           type: ‘string’ },
  { name: ‘toPerp’,           type: ‘bool’   },
  { name: ‘nonce’,            type: ‘uint64’ },
  ],
  };
  const message = {
  hyperliquidChain: action.hyperliquidChain,
  amount:           action.amount,
  toPerp:           action.toPerp,
  nonce:            action.nonce,
  };
  const sig   = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
  }

/**

- Build, sign, and submit a usdClassTransfer.
- 
- @param {object} args - {
- masterPrivateKey,
- amount,        // number or string in USDC
- toPerp,        // boolean: true = spot→perp, false = perp→spot
- hlRequest,     // your hlRequest helper
- }
- @returns {Promise<object>} the HL response
  */
  export async function submitUsdClassTransfer({
  masterPrivateKey,
  amount,
  toPerp,
  hlRequest,
  }) {
  const nonce = nextNonce();
  const amountStr = typeof amount === ‘string’ ? amount : String(amount);
  const action = {
  type:             ‘usdClassTransfer’,
  hyperliquidChain: ‘Mainnet’,
  signatureChainId: ‘0xa4b1’,
  amount:           amountStr,
  toPerp:           !!toPerp,
  nonce,
  };
  const signature = await signUsdClassTransfer(masterPrivateKey, action);
  const result = await hlRequest({ action, nonce, signature }, true);
  if (result?.status === ‘err’) {
  const reason = typeof result?.response === ‘string’
  ? result.response : JSON.stringify(result);
  throw new Error(`usdClassTransfer failed: ${reason}`);
  }
  return result;
  }

// —– spotSend —–

/**

- Sign a spotSend action.
- Sends a spot token (e.g. uSOL) to another address on HL.
- 
- Token format is “name:tokenId” — e.g. “SOL:0xc4b7…”.
- Fetch the tokenId from spotMeta.tokens (matching by name).
- 
- @param {string}  masterPrivateKey
- @param {object}  action - {
- type: ‘spotSend’,
- hyperliquidChain: ‘Mainnet’,
- signatureChainId: ‘0xa4b1’,
- destination: ‘0x…’,    // recipient HL address
- token: ‘SOL:0x….’,     // tokenName:tokenId
- amount: ‘0.5’,           // string
- time: <ms>,              // matches nonce
- }
  */
  export async function signSpotSend(masterPrivateKey, action) {
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(masterPrivateKey);
  const domain = {
  name: ‘HyperliquidSignTransaction’, version: ‘1’,
  chainId: 42161,
  verifyingContract: ‘0x0000000000000000000000000000000000000000’,
  };
  const types = {
  ‘HyperliquidTransaction:SpotSend’: [
  { name: ‘hyperliquidChain’, type: ‘string’ },
  { name: ‘destination’,      type: ‘string’ },
  { name: ‘token’,            type: ‘string’ },
  { name: ‘amount’,           type: ‘string’ },
  { name: ‘time’,             type: ‘uint64’ },
  ],
  };
  const message = {
  hyperliquidChain: action.hyperliquidChain,
  destination:      action.destination,
  token:            action.token,
  amount:           action.amount,
  time:             action.time,
  };
  const sig   = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
  }

/**

- Build, sign, and submit a spotSend.
- 
- @param {object} args - {
- masterPrivateKey,
- destination,    // 0x.. recipient on HL
- tokenName,      // e.g. “SOL”
- tokenId,        // e.g. “0xc4b7…”  (from spotMeta.tokens)
- amount,         // number or string
- hlRequest,
- }
  */
  export async function submitSpotSend({
  masterPrivateKey,
  destination,
  tokenName,
  tokenId,
  amount,
  hlRequest,
  }) {
  const time = nextNonce();
  const amountStr = typeof amount === ‘string’ ? amount : String(amount);
  const token = `${tokenName}:${tokenId}`;
  const action = {
  type:             ‘spotSend’,
  hyperliquidChain: ‘Mainnet’,
  signatureChainId: ‘0xa4b1’,
  destination,
  token,
  amount:           amountStr,
  time,
  };
  const signature = await signSpotSend(masterPrivateKey, action);
  const result = await hlRequest({ action, nonce: time, signature }, true);
  if (result?.status === ‘err’) {
  const reason = typeof result?.response === ‘string’
  ? result.response : JSON.stringify(result);
  throw new Error(`spotSend failed: ${reason}`);
  }
  return result;
  }

// —– helpers for finding tokens & balances —–

/**

- Look up a spot token by name in the spotMeta response.
- Returns { name, tokenId, index, szDecimals, weiDecimals } or null.
- 
- Names on HL mainnet for our use:
- - USDC: ‘USDC’  (token 0)
- - SOL:  ‘SOL’   (the uSOL token bridged from Solana via Unit)
    */
    export function findSpotToken(spotMeta, name) {
    if (!spotMeta?.tokens) return null;
    const t = spotMeta.tokens.find(x => x?.name?.toUpperCase() === String(name).toUpperCase());
    if (!t) return null;
    return {
    name: t.name,
    tokenId: t.tokenId,
    index: t.index,
    szDecimals: t.szDecimals,
    weiDecimals: t.weiDecimals,
    };
    }

/**

- Find a spot trading pair by base/quote token names.
- 
- Returns { pairName, pairIndex, baseToken, quoteToken, assetId }
- where assetId = 10000 + pairIndex (used for orders).
- 
- Example:  findSpotPair(spotMeta, ‘SOL’, ‘USDC’)
  */
  export function findSpotPair(spotMeta, baseName, quoteName) {
  if (!spotMeta?.tokens || !spotMeta?.universe) return null;
  const base  = findSpotToken(spotMeta, baseName);
  const quote = findSpotToken(spotMeta, quoteName);
  if (!base || !quote) return null;

const pair = spotMeta.universe.find(u =>
Array.isArray(u?.tokens) &&
u.tokens[0] === base.index &&
u.tokens[1] === quote.index
);
if (!pair) return null;
return {
pairName: pair.name,                  // e.g. “@107” or “PURR/USDC”
pairIndex: pair.index,                // 0-indexed within universe
baseToken: base,
quoteToken: quote,
assetId: 10000 + pair.index,          // what /exchange expects in order action
};
}

/**

- Read a user’s spot balance for a given token name.
- Returns the total balance as a Number (not BigInt).
- 
- @param {object} spotState - result of { type: ‘spotClearinghouseState’, user }
- @param {string} tokenName
  */
  export function spotBalanceOf(spotState, tokenName) {
  if (!spotState?.balances) return 0;
  const row = spotState.balances.find(b =>
  String(b?.coin || ‘’).toUpperCase() === String(tokenName).toUpperCase()
  );
  if (!row) return 0;
  return parseFloat(row.total || ‘0’);
  }

/**

- Read available (not held) spot balance.
- Available = total − hold (amount locked in resting limit orders).
  */
  export function spotAvailableOf(spotState, tokenName) {
  if (!spotState?.balances) return 0;
  const row = spotState.balances.find(b =>
  String(b?.coin || ‘’).toUpperCase() === String(tokenName).toUpperCase()
  );
  if (!row) return 0;
  const total = parseFloat(row.total || ‘0’);
  const held  = parseFloat(row.hold  || ‘0’);
  return Math.max(0, total - held);
  }