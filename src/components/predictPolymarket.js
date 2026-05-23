// src/components/predictPolymarket.js
//
// Isolated Polymarket module for the Predict page.
// - Solana-only auth (uses @solana/wallet-adapter-react)
// - Derives an EVM key in memory from a single Solana signature
// - Never persists the key anywhere
// - All Polymarket protocol calls go through /api/poly proxy
//
// The rest of the app keeps using WalletContext.js untouched.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { keccak_256 } from 'js-sha3';
import { privateKeyToAccount } from 'viem/accounts';

const SIGN_MESSAGE =
  'Polymarket trading account\n' +
  'Sign once to create your non-custodial trading account.\n' +
  'This signature derives an EVM key that lives only in your browser memory.\n' +
  'Only sign this on apps you trust.\n' +
  'Solana: ';

const POLY_API = '/api/poly';

// ─── Public hook ────────────────────────────────────────────────────────────

export function usePolymarketWallet() {
  const { publicKey, signMessage, connected } = useWallet();
  const [evmAccount, setEvmAccount] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState(null);

  // Drop derived key whenever the Solana wallet disconnects or switches.
  const lastPk = useRef(null);
  useEffect(() => {
    const pk = publicKey?.toBase58() || null;
    if (lastPk.current !== pk) {
      lastPk.current = pk;
      setEvmAccount(null);
    }
  }, [publicKey]);

  const signIn = useCallback(async () => {
    if (!publicKey) { setError('Connect a Solana wallet first'); return null; }
    if (!signMessage) { setError('Your Solana wallet does not support signMessage'); return null; }
    setSigningIn(true);
    setError(null);
    try {
      const msg = new TextEncoder().encode(SIGN_MESSAGE + publicKey.toBase58());
      const sig = await signMessage(msg);
      // 32-byte EVM private key derived from the signature.
      const hex = keccak_256(sig);
      const pk  = '0x' + hex;
      const account = privateKeyToAccount(pk);
      // Best-effort wipe of the raw signature buffer.
      try { sig.fill?.(0); } catch {}
      setEvmAccount(account);
      return account;
    } catch (e) {
      const m = e?.message || 'Signature rejected';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      return null;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(() => {
    setEvmAccount(null);
    setError(null);
  }, []);

  return useMemo(() => ({
    solanaConnected: connected,
    solanaPubkey: publicKey?.toBase58() || null,
    evmAddress: evmAccount?.address || null,
    evmAccount,        // viem LocalAccount — used to sign EIP-712 / messages
    authenticated: !!evmAccount,
    signingIn,
    error,
    signIn,
    signOut,
  }), [connected, publicKey, evmAccount, signingIn, error, signIn, signOut]);
}

// ─── Proxy API helpers ──────────────────────────────────────────────────────

async function postJson(path, body) {
  const r = await fetch(POLY_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Non-JSON ${r.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) {
    const msg = data?.detail || data?.error || data?.message || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function getJson(path) {
  const r = await fetch(POLY_API + path, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Non-JSON ${r.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) {
    const msg = data?.detail || data?.error || data?.message || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ─── High-level operations ──────────────────────────────────────────────────
//
// Pattern: every state-changing call is server-orchestrated. The server
// returns either { ok: true } (gasless via builder relayer, no user sig
// needed) or { needsSignature: { typedData } } — in which case we ask the
// user's derived EVM key to sign and POST it back.

async function signAndSubmit(path, evmAccount, prep) {
  // Server may return { ok: true, ... } directly for gasless ops.
  if (prep?.ok && !prep?.needsSignature) return prep;

  const ns = prep?.needsSignature;
  if (!ns) return prep;

  let signature;
  if (ns.typedData) {
    signature = await evmAccount.signTypedData(ns.typedData);
  } else if (ns.message) {
    signature = await evmAccount.signMessage({ message: { raw: ns.message } });
  } else {
    throw new Error('Server requested a signature but provided no payload');
  }

  return await postJson(path + '/submit', {
    requestId: ns.requestId,
    signature,
  });
}

/**
 * Idempotent: derive + deploy deposit wallet, approve trading contracts,
 * derive CLOB credentials. Returns { depositWallet }.
 */
export async function setupAccount(evmAddress, evmAccount) {
  if (!evmAddress) throw new Error('No EVM address');
  const prep = await postJson('/setup', { owner: evmAddress });
  await signAndSubmit('/setup', evmAccount, prep);
  return prep;
}

/** Returns { balance: "string-pUSD-atomic", depositWallet } */
export async function getBalance(evmAddress) {
  if (!evmAddress) return { balance: '0', depositWallet: null };
  return await getJson(`/balance/${encodeURIComponent(evmAddress)}`);
}

export async function getPositions(evmAddress, conditionId) {
  if (!evmAddress) return [];
  const q = conditionId ? `?conditionId=${encodeURIComponent(conditionId)}` : '';
  const r = await getJson(`/positions/${encodeURIComponent(evmAddress)}${q}`);
  return Array.isArray(r) ? r : (r?.positions || []);
}

export async function buy({ evmAddress, evmAccount, market, side, usd }) {
  const prep = await postJson('/buy', {
    owner: evmAddress,
    conditionId: market.conditionId,
    tokenId: side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1],
    side: 'BUY',
    usd,
    price: side === 'yes' ? market.yesPrice : market.noPrice,
    tickSize: market.tickSize || '0.01',
    negRisk: !!market.negRisk,
  });
  return await signAndSubmit('/buy', evmAccount, prep);
}

export async function sell({ evmAddress, evmAccount, market, side, shares }) {
  const prep = await postJson('/sell', {
    owner: evmAddress,
    conditionId: market.conditionId,
    tokenId: side === 'yes' ? market.clobTokenIds[0] : market.clobTokenIds[1],
    side: 'SELL',
    shares,
    price: side === 'yes' ? market.yesPrice : market.noPrice,
    tickSize: market.tickSize || '0.01',
    negRisk: !!market.negRisk,
  });
  return await signAndSubmit('/sell', evmAccount, prep);
}

export async function redeem({ evmAddress, evmAccount, market }) {
  const prep = await postJson('/redeem', {
    owner: evmAddress,
    conditionId: market.conditionId,
    negRisk: !!market.negRisk,
  });
  return await signAndSubmit('/redeem', evmAccount, prep);
}
