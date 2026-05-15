# /* ============================================================
hlAgentWallet.js — HL API/Agent Wallet management

Agent (API) wallets are HL’s mechanism for letting a dapp sign
trading actions on the user’s behalf without exposing the user’s
master private key.

Important constraints (from HL docs):

- Agents CAN sign L1 actions: order, cancel, modify, leverage updates
- Agents CANNOT sign user-signed actions: usdClassTransfer, spotSend,
  withdraw3, approveBuilderFee, approveAgent itself
- approveAgent must be signed by the master wallet (the HL-derived
  key from your Solana signature)
- HL stores the 100 highest nonces per signer, so agents need fresh
  keys per session (don’t reuse old agent addresses)
- Named agents are limited to 3 per account; unnamed limited to 1
  and overwriting a named agent with the same name replaces the old one

The agent private key is stored in localStorage tied to the user’s
HL address. If the user clears storage or switches devices, they re-
approve a new agent (cheap, one HL sig).

============================================================ */

// Reuse the same ethers loader pattern as PerpsTrade.js so we don’t
// double-bundle ethers if the host app already imports it.
let _ethersModule = null;
async function getEthers() {
if (_ethersModule) return _ethersModule;
_ethersModule = await import(‘ethers’);
return _ethersModule;
}
function getEthersNs(mod) {
if (!mod) return null;
if (mod.ethers?.Wallet) return mod.ethers;
if (mod.Wallet) return mod;
if (mod.default?.Wallet) return mod.default;
return null;
}
async function signTypedDataCompat(wallet, domain, types, value) {
if (typeof wallet.signTypedData === ‘function’)  return wallet.signTypedData(domain, types, value);
if (typeof wallet._signTypedData === ‘function’) return wallet._signTypedData(domain, types, value);
throw new Error(‘Wallet does not support typed data signing’);
}
function splitSigCompat(ethersNs, sig) {
if (ethersNs.Signature?.from)       return ethersNs.Signature.from(sig);
if (ethersNs.utils?.splitSignature) return ethersNs.utils.splitSignature(sig);
throw new Error(‘Cannot split signature’);
}

// —– nonce management —–

let _lastNonce = 0;
export function nextNonce() {
const now = Date.now();
const n = now > _lastNonce ? now : _lastNonce + 1;
_lastNonce = n;
return n;
}

// —– agent key storage —–

const AGENT_KEY_PREFIX = ‘nexus_agent_’;
const AGENT_NAME = ‘NexusDEX’;                  // visible to user in HL UI
const AGENT_VALIDITY_DAYS = 180;                // ~6 months

function agentStorageKey(hlAddress) {
return AGENT_KEY_PREFIX + hlAddress.toLowerCase();
}

/**

- Read the cached agent for a user, if any.
- Returns null if no agent stored or storage unavailable.
  */
  export function getStoredAgent(hlAddress) {
  if (!hlAddress) return null;
  try {
  const raw = localStorage.getItem(agentStorageKey(hlAddress));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed?.privateKey || !parsed?.address) return null;
  // expire after AGENT_VALIDITY_DAYS
  if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
  localStorage.removeItem(agentStorageKey(hlAddress));
  return null;
  }
  return parsed;
  } catch {
  return null;
  }
  }

function setStoredAgent(hlAddress, agent) {
try {
localStorage.setItem(agentStorageKey(hlAddress), JSON.stringify(agent));
} catch {}
}

export function clearStoredAgent(hlAddress) {
if (!hlAddress) return;
try { localStorage.removeItem(agentStorageKey(hlAddress)); } catch {}
}

// —– agent key generation —–

/**

- Generate a fresh agent keypair using browser crypto.
- Returns { privateKey: “0x…”, address: “0x…” }.
- 
- HL recommends never reusing agent addresses, so this generates
- a brand-new key each call.
  */
  export async function generateAgentKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const privateKey = ‘0x’ + […bytes].map(b => b.toString(16).padStart(2, ‘0’)).join(’’);
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(privateKey);
  return { privateKey, address: wallet.address.toLowerCase() };
  }

// —– signing approveAgent (master wallet) —–

/**

- Sign the approveAgent action with the user’s HL-derived master wallet.
- Returns the signature object suitable for the /exchange endpoint.
- 
- The approveAgent action authorizes the agent to sign L1 actions on
- behalf of the master account. It does NOT grant withdraw permission.
- 
- @param {string} masterPrivateKey  - the HL-derived master wallet’s key
- @param {object} action            - { type, hyperliquidChain, signatureChainId, agentAddress, agentName, nonce }
  */
  export async function signApproveAgent(masterPrivateKey, action) {
  const mod      = await getEthers();
  const ethersNs = getEthersNs(mod);
  const wallet   = new ethersNs.Wallet(masterPrivateKey);
  const domain   = {
  name: ‘HyperliquidSignTransaction’, version: ‘1’,
  chainId: 42161,  // 0xa4b1 for Arbitrum-signed user actions
  verifyingContract: ‘0x0000000000000000000000000000000000000000’,
  };
  const types = {
  ‘HyperliquidTransaction:ApproveAgent’: [
  { name: ‘hyperliquidChain’, type: ‘string’ },
  { name: ‘agentAddress’,     type: ‘address’ },
  { name: ‘agentName’,        type: ‘string’ },
  { name: ‘nonce’,            type: ‘uint64’ },
  ],
  };
  const message = {
  hyperliquidChain: action.hyperliquidChain,
  agentAddress:     action.agentAddress,
  agentName:        action.agentName || ‘’,
  nonce:            action.nonce,
  };
  const sig   = await signTypedDataCompat(wallet, domain, types, message);
  const split = splitSigCompat(ethersNs, sig);
  return { r: split.r, s: split.s, v: Number(split.v) };
  }

// —– approve-and-store agent helper —–

/**

- One-stop helper to onboard a fresh agent for a user.
- 
- 1. Generates a new agent keypair
- 1. Builds the approveAgent action
- 1. Has the master wallet sign it
- 1. Submits to the HL /exchange endpoint
- 1. On success, persists the agent key to localStorage
- 
- If an agent is already stored AND it’s still on-chain (no way to
- verify cheaply without an HL query, so we trust localStorage), this
- is a no-op.
- 
- @param {string} masterPrivateKey  - HL-derived key
- @param {string} hlAddress         - HL-derived address (for cache key)
- @param {function} hlRequest       - your existing hlRequest helper from PerpsTrade
- @returns {Promise<{ privateKey, address, name, expiresAt }>}
  */
  export async function ensureAgentApproved({ masterPrivateKey, hlAddress, hlRequest }) {
  // Already stored?
  const cached = getStoredAgent(hlAddress);
  if (cached) return cached;

// Generate a fresh agent
const agent = await generateAgentKey();
const nonce = nextNonce();

// Build approveAgent action. agentName encodes the expiry to make
// it visible to the user in HL’s UI and to allow easy renewal.
const expiresAt = Date.now() + AGENT_VALIDITY_DAYS * 24 * 3600 * 1000;
const agentName = `${AGENT_NAME} valid_until ${expiresAt}`;

const action = {
type:             ‘approveAgent’,
hyperliquidChain: ‘Mainnet’,
signatureChainId: ‘0xa4b1’,
agentAddress:     agent.address,
agentName,
nonce,
};
const signature = await signApproveAgent(masterPrivateKey, action);
const result = await hlRequest({ action, nonce, signature }, true);

if (result?.status === ‘err’) {
const reason = typeof result?.response === ‘string’
? result.response
: JSON.stringify(result);
throw new Error(`Agent approval failed: ${reason}`);
}

const stored = {
privateKey: agent.privateKey,
address:    agent.address,
name:       agentName,
approvedAt: Date.now(),
expiresAt,
};
setStoredAgent(hlAddress, stored);
return stored;
}

// —– signing L1 actions with the agent —–

/**

- Sign an L1 action (order, cancel, modify, leverage) using the agent
- private key. This is the silent-trade path.
- 
- Use your existing signL1Action import from @nktkas/hyperliquid/signing.
- This module doesn’t import it directly to avoid double-importing the
- SDK in your bundle.
- 
- Usage from your component:
- 
- import { signL1Action } from ‘@nktkas/hyperliquid/signing’;
- import { getOrApproveAgent, getAgentWallet } from ‘./hlAgentWallet’;
- 
- const agent = await ensureAgentApproved({ masterPrivateKey, hlAddress, hlRequest });
- const ethersNs = getEthersNs(await getEthers());
- const agentWallet = new ethersNs.Wallet(agent.privateKey);
- const signature = await signL1Action({ wallet: agentWallet, action, nonce });
- 
- For convenience, this module exposes a `withAgentSigner` helper that
- wraps that pattern.
  */
  export async function withAgentSigner(hlAddress) {
  const stored = getStoredAgent(hlAddress);
  if (!stored) throw new Error(‘Agent not approved — call ensureAgentApproved first’);
  const ethersNs = getEthersNs(await getEthers());
  const wallet = new ethersNs.Wallet(stored.privateKey);
  return wallet;
  }

/**

- Quick check: is there an agent on file for this user?
- Does NOT verify on-chain — just checks localStorage.
- 
- For on-chain verification, query the HL info endpoint with
- { type: ‘extraAgents’, user: hlAddress }
- but this is rarely needed.
  */
  export function isAgentApproved(hlAddress) {
  return !!getStoredAgent(hlAddress);
  }

/**

- Query HL for currently authorized agents.
- Useful for debugging / showing the user which agents are active.
- 
- @returns {Promise<Array<{address, name, validUntil}>>}
  */
  export async function fetchOnChainAgents({ hlAddress, hlRequest }) {
  try {
  const result = await hlRequest({ type: ‘extraAgents’, user: hlAddress });
  if (!Array.isArray(result)) return [];
  return result.map(a => ({
  address: a.address,
  name: a.name,
  validUntil: a.validUntil,
  }));
  } catch (e) {
  console.warn(’[agents query]’, e?.message);
  return [];
  }
  }

// —– helpful re-exports for callers that want internals —–

export { getEthers, getEthersNs, signTypedDataCompat, splitSigCompat };