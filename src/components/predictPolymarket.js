// src/components/predictPolymarket.js
//
// Solana-only, non-custodial Polymarket wallet for the Predict page.
//
// User connects a Solana wallet, signs ONE deterministic message, and we
// derive an EVM private key from that signature. The key lives in React
// state only — never persisted, never sent anywhere.
//
// Exposes an EIP-1193 provider so the existing Polymarket SDK code in
// Predict.jsx (createWalletClient + viem.custom(provider)) works without
// changes.

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

const POLYGON_RPC = 'https://polygon-rpc.com';

export function usePolymarketWallet() {
  const { publicKey, signMessage, connected } = useWallet();
  const [evmAccount, setEvmAccount] = useState(null);
  const [signingIn, setSigningIn]   = useState(false);
  const [error, setError]           = useState(null);
  const providerRef = useRef(null);

  // Drop derived key when the Solana wallet disconnects or switches.
  const lastPk = useRef(null);
  useEffect(() => {
    const pk = publicKey?.toBase58() || null;
    if (lastPk.current !== pk) {
      lastPk.current = pk;
      setEvmAccount(null);
      providerRef.current = null;
    }
  }, [publicKey]);

  // Build a minimal EIP-1193 provider over the derived account.
  // The Polymarket SDK only needs: eth_accounts, eth_chainId, personal_sign,
  // eth_signTypedData_v4. Everything else falls through to the public RPC.
  const buildProvider = useCallback((account) => {
    return {
      request: async ({ method, params }) => {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [account.address];
          case 'eth_chainId':
            return '0x89';
          case 'personal_sign': {
            const [data] = params || [];
            return account.signMessage({ message: { raw: data } });
          }
          case 'eth_signTypedData_v4':
          case 'eth_signTypedData': {
            const [, json] = params || [];
            const typed = typeof json === 'string' ? JSON.parse(json) : json;
            return account.signTypedData(typed);
          }
          default: {
            const r = await fetch(POLYGON_RPC, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            });
            const j = await r.json();
            if (j.error) throw new Error(j.error.message || 'RPC error');
            return j.result;
          }
        }
      },
      on:             () => {},
      removeListener: () => {},
      isMetaMask:     false,
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!publicKey) { setError('Connect a Solana wallet first'); return null; }
    if (!signMessage) { setError('Your Solana wallet does not support signMessage'); return null; }
    setSigningIn(true);
    setError(null);
    try {
      const msg = new TextEncoder().encode(SIGN_MESSAGE + publicKey.toBase58());
      const sig = await signMessage(msg);
      const hex = keccak_256(sig);
      const account = privateKeyToAccount('0x' + hex);
      try { sig.fill?.(0); } catch {}
      providerRef.current = buildProvider(account);
      setEvmAccount(account);
      return account;
    } catch (e) {
      const m = e?.message || 'Signature rejected';
      setError(/reject|cancel|user/i.test(m) ? 'Cancelled' : m);
      return null;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage, buildProvider]);

  const signOut = useCallback(() => {
    setEvmAccount(null);
    providerRef.current = null;
    setError(null);
  }, []);

  return useMemo(() => ({
    solanaConnected: connected,
    solanaPubkey: publicKey?.toBase58() || null,
    authenticated: !!evmAccount,
    signingIn,
    error,
    signIn,
    signOut,
    // Shape matches what original Predict.jsx expects from useNexusWallet:
    getEvmAddress:  () => evmAccount?.address || null,
    getEvmProvider: async () => providerRef.current || null,
  }), [connected, publicKey, evmAccount, signingIn, error, signIn, signOut]);
}
