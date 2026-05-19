// derived-key.js
//
// Derives a deterministic Polygon (secp256k1) keypair from a Solana
// (Ed25519) signature. Same Solana wallet always yields the same
// Polygon address. Cached in localStorage keyed by Solana pubkey.
//
// SECURITY MODEL
// --------------
// - The derived EVM private key is a deterministic function of the
//   user's Solana signature over a fixed, versioned message. Same
//   wallet + same message = same key, always.
// - The user can ALWAYS recover their derived key by signing the same
//   message again. Loss of localStorage is recoverable; loss of the
//   Solana key is not (but losing the Solana key already loses
//   everything else, so this is no worse).
// - We store the derived EVM private key in localStorage in plaintext.
//   If a malicious script runs in the same origin, it can read this
//   AND call the Solana wallet's signMessage anyway, so encryption
//   would only stop passive disk reads — not a real attacker. The
//   funds at the derived address are bounded (only Polymarket
//   positions and bridged USDC in transit), and never include the
//   user's main Solana wallet balance.
// - Derivation message is shown to the user in their Solana wallet
//   popup, so they always know what they're signing.
//
// WIRE FORMAT
// -----------
// signMessage: (Uint8Array) -> Promise<Uint8Array>  (64-byte Ed25519 sig)
// Derived key: 32 bytes = SHA-256(SHA-256(sig) || "nexus-derive-v1")
// Polygon address: keccak256 of secp256k1 pubkey (last 20 bytes), via viem
//
// USAGE
// -----
//   import { getOrDeriveEvmKey, peekDerivedAddress } from './derived-key';
//
//   const wallet = useWallet();
//   const { privateKey, address, cached } = await getOrDeriveEvmKey({
//     solPubkey: wallet.publicKey.toString(),
//     signMessage: wallet.signMessage,
//   });
//   // cached=true: silent. cached=false: user just signed the prompt.

import { privateKeyToAccount } from 'viem/accounts';

const VERSION  = 1;
const DOMAIN   = 'nexus-derive-v' + VERSION;
const KEY_NS   = 'nexus_derived_evm_v' + VERSION + '_';

// Human-readable derivation message. This shows to the user inside
// their Solana wallet's signMessage popup, so it must be clear about
// what's happening and that signing grants no spending permissions.
function derivationMessage(solPubkey) {
  return [
    'Welcome to Nexus DEX',
    '',
    'Sign this message to derive your Polygon trading address.',
    '',
    'This is a FREE, deterministic signature. It does NOT grant Nexus',
    'or anyone permission to move your funds. You can always recover',
    'your trading address by signing this message again.',
    '',
    'Wallet: ' + solPubkey,
    'Version: ' + VERSION,
  ].join('\n');
}

// ---- byte helpers ----------------------------------------------------------
function concat(a, b) {
  const r = new Uint8Array(a.length + b.length);
  r.set(a); r.set(b, a.length);
  return r;
}
function textBytes(s) { return new TextEncoder().encode(s); }
function bytesToHex(b) {
  let out = '0x';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}
async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

// secp256k1 curve order (n). 32-byte SHA-256 outputs are < n with
// astronomical probability; we still validate via viem.
async function sigToEvmPrivateKey(solSigBytes) {
  const h1 = await sha256Bytes(solSigBytes);
  const h2 = await sha256Bytes(concat(h1, textBytes(DOMAIN)));
  return bytesToHex(h2); // 0x-prefixed 32-byte hex
}

// ---- public API ------------------------------------------------------------

// Returns { privateKey, address, cached }. If `cached` is false, the
// user was just shown a Solana signature prompt. If true, the result
// came from localStorage with no popup.
export async function getOrDeriveEvmKey({ solPubkey, signMessage }) {
  if (!solPubkey)                        throw new Error('solPubkey required');
  if (typeof signMessage !== 'function') throw new Error('Wallet does not support signMessage');

  // Cache hit
  try {
    const raw = localStorage.getItem(KEY_NS + solPubkey);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.privateKey && obj?.address && obj?.solPubkey === solPubkey) {
        return { privateKey: obj.privateKey, address: obj.address, cached: true };
      }
    }
  } catch {}

  // Sign and derive
  const msg = derivationMessage(solPubkey);
  const sig = await signMessage(textBytes(msg));
  if (!sig || sig.length !== 64) throw new Error('Invalid Solana signature length: expected 64 bytes');

  const privateKey = await sigToEvmPrivateKey(sig);

  let account;
  try   { account = privateKeyToAccount(privateKey); }
  catch (e) { throw new Error('Derived key validation failed: ' + (e?.message || e)); }

  const record = { privateKey, address: account.address, solPubkey };
  try { localStorage.setItem(KEY_NS + solPubkey, JSON.stringify(record)); } catch {}

  return { privateKey, address: account.address, cached: false };
}

// Returns the cached Polygon address for a Solana wallet without
// prompting any signature. Returns null if not previously derived.
export function peekDerivedAddress(solPubkey) {
  if (!solPubkey) return null;
  try {
    const raw = localStorage.getItem(KEY_NS + solPubkey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj?.address && obj?.solPubkey === solPubkey) return obj.address;
  } catch {}
  return null;
}

// Returns the cached privateKey if already derived; null otherwise.
// Used by background tasks (auto-execute on funds-landed,
// auto-withdraw on resolved-position) that should silently re-use the
// key without re-prompting.
export function peekDerivedKey(solPubkey) {
  if (!solPubkey) return null;
  try {
    const raw = localStorage.getItem(KEY_NS + solPubkey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj?.privateKey && obj?.address && obj?.solPubkey === solPubkey) {
      return { privateKey: obj.privateKey, address: obj.address };
    }
  } catch {}
  return null;
}

export function clearDerivedKey(solPubkey) {
  try { localStorage.removeItem(KEY_NS + solPubkey); } catch {}
}

// Exported for the BuyModal UI to show the user what they'll sign.
export const previewDerivationMessage = derivationMessage;
