/**
 * NEXUS DEX — Cross-Chain (LI.FI, atomic single-tx, fee in SOL)
 *
 * Atomic flow:
 *   1. LI.FI /quote with FULL amount — fee is taken in SOL separately,
 *      so the user bridges 100% of their input token.
 *   2. Deserialize LI.FI's bridge tx, decompile its message (with ALTs).
 *   3. Prepend a SystemProgram.transfer for 5% of fromAmountUSD worth of SOL
 *      to FEE_WALLET.
 *   4. Recompile to a v0 message with the same ALTs and a fresh blockhash.
 *   5. Simulate ONCE on the exact bytes the user will sign.
 *   6. wallet.signTransaction — one popup, wallet simulates the full tx,
 *      Blowfish sees the complete net effect.
 *   7. Send, confirm with Solscan fallback.
 *
 * Fee unit: ALWAYS SOL. User needs SOL beyond what they're bridging to
 * cover the platform fee. UI surfaces this clearly when input isn't SOL.
 *
 * If the bridge tx reverts, the fee transfer reverts with it — atomic.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';

/* ─── CONSTANTS ─── */

const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;
const SLIPPAGE   = 0.005;

const SOL_NATIVE      = '11111111111111111111111111111111';
const WSOL_MINT       = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LIFI_SOLANA_ID  = 1151111081099710;
const SOL_RESERVE     = 1_500_000;            // 0.0015 SOL kept for network fees
const MIN_FEE_LAMPORTS = 1_000_000;            // 0.001 SOL fee floor (~$0.15)
const QUOTE_DEBOUNCE  = 400;

/* ─── STYLE ─── */

const C = {
  bg: '#03060f', card: '#080d1a', card2: '#0c1220', card3: '#111d30',
  border: 'rgba(0,229,255,0.10)', borderHi: 'rgba(0,229,255,0.25)',
  accent: '#00e5ff', green: '#00ffa3', red: '#ff3b6b',
  text: '#cdd6f4', muted: '#586994', muted2: '#2e3f5e',
  buyGrad: 'linear-gradient(135deg,#00e5ff,#0055ff)',
  successGrad: 'linear-gradient(135deg,#00ffa3,#00b36b)',
};

/* ─── FORMATTERS ─── */

const trimZeros = v => String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
const decsForDisplay = n => {
  const v = +n;
  if (!Number.isFinite(v)) return 4;
  if (v === 0)   return 2;
  if (v < 1e-8)  return 12;
  if (v < 1e-6)  return 10;
  if (v < 0.01)  return 8;
  if (v < 1)     return 6;
  return 4;
};
const fmtTok = n => {
  if (n == null || isNaN(n)) return '0';
  const v = +n;
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9)   return trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)   return trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000)  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return trimZeros(v.toFixed(decsForDisplay(v)));
};
const fmtInput = (n, dec = 9) => {
  const v = +n;
  if (!Number.isFinite(v) || v <= 0) return '';
  const m = Math.min(Math.max(+dec || 6, 0), 12);
  return trimZeros(v.toFixed(m));
};
const fmtUsd = (n, d = 2) => {
  if (n == null || isNaN(n)) return '-';
  const v = +n;
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9)  return '$' + trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6)  return '$' + trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (v >= 1)    return '$' + v.toFixed(d);
  if (v > 0)     return '$' + trimZeros(v.toFixed(v < 1e-6 ? 10 : 8));
  return '$0.00';
};
const toRaw = (s, dec) => {
  if (!s || dec == null) return '0';
  let v = String(s).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!v || v.startsWith('-')) return '0';
  if (/e/i.test(v)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return '0';
    v = n.toFixed(Math.max(+dec || 0, 20));
  }
  const d = Math.floor(+dec);
  if (!Number.isFinite(d) || d < 0 || d > 18) return '0';
  const [w, f = ''] = v.split('.');
  const sw = (w || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const ft = (f || '').replace(/[^\d]/g, '').slice(0, d);
  const fp = (ft + '0'.repeat(d)).slice(0, d);
  try { return (BigInt(sw) * (10n ** BigInt(d)) + BigInt(fp)).toString(); }
  catch { return '0'; }
};
const maxSafeSol = lamports =>
  lamports ? Math.max(0, lamports - SOL_RESERVE) / LAMPORTS_PER_SOL : 0;

const isValidSolMint = s =>
  !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

const validateDest = (addr, chainType) => {
  if (!addr || !addr.trim()) return 'Destination address required';
  const a = addr.trim();
  if (chainType === 'EVM') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'Invalid EVM address';
  } else if (chainType === 'SVM') {
    if (!isValidSolMint(a)) return 'Invalid Solana address';
  } else if (chainType === 'UTXO') {
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,80}$/.test(a)) return 'Invalid Bitcoin address';
  } else if (chainType === 'MVM') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(a)) return 'Invalid SUI address';
  }
  return null;
};

const lifiFromToken = mint => (mint === WSOL_MINT ? SOL_NATIVE : mint);

/* ─── ERRORS ─── */

const friendlyError = err => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient sol') || m.includes('not enough sol'))
    return 'Not enough SOL to cover the platform fee and network fee.';
  if (m.includes('insufficient') || m.includes('not enough'))
    return 'Insufficient balance for this bridge.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('slippage'))
    return 'Price moved too much. Try again.';
  if (m.includes('no route') || m.includes('no available') || m.includes('not found'))
    return 'No bridge route available for this pair right now.';
  if (m.includes('minimum') || m.includes('too small'))
    return 'Amount is too small — bridge fees would exceed the swap.';
  if (m.includes('429') || m.includes('rate limit'))
    return 'Too many requests — please wait a moment.';
  if (m.includes('timeout') || m.includes('timed out'))
    return 'Network is slow — please try again.';
  if (m.includes('account not') || m.includes('uninitialized'))
    return 'Token account not ready. Try again in a moment.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit our fee in one transaction. Try a different token or amount.';
  return err?.message || 'Bridge failed. Please try again.';
};

/* ─── CHAINS (live from LI.FI) ─── */

let _chainsCache = null, _chainsLoading = null;
const loadChains = () => {
  if (_chainsCache)   return Promise.resolve(_chainsCache);
  if (_chainsLoading) return _chainsLoading;
  _chainsLoading = fetch('/api/lifi/chains')
    .then(r => (r.ok ? r.json() : { chains: [] }))
    .then(j => {
      const list = Array.isArray(j?.chains) ? j.chains : (Array.isArray(j) ? j : []);
      const out = {};
      for (const c of list) {
        out[String(c.id)] = {
          id:       String(c.id),
          key:      c.key || c.coin || String(c.id),
          name:     c.name || ('Chain ' + c.id),
          chainType: c.chainType || 'EVM',
          logoURI:  c.logoURI || c.iconUrl || null,
        };
      }
      _chainsCache = out;
      _chainsLoading = null;
      return out;
    })
    .catch(e => {
      _chainsLoading = null;
      _chainsCache = {
        '1':     { id:'1',     name:'Ethereum',  chainType:'EVM' },
        '56':    { id:'56',    name:'BNB Chain', chainType:'EVM' },
        '137':   { id:'137',   name:'Polygon',   chainType:'EVM' },
        '42161': { id:'42161', name:'Arbitrum',  chainType:'EVM' },
        '10':    { id:'10',    name:'Optimism',  chainType:'EVM' },
        '43114': { id:'43114', name:'Avalanche', chainType:'EVM' },
        '8453':  { id:'8453',  name:'Base',      chainType:'EVM' },
        '59144': { id:'59144', name:'Linea',     chainType:'EVM' },
        '324':   { id:'324',   name:'zkSync',    chainType:'EVM' },
        '100':   { id:'100',   name:'Gnosis',    chainType:'EVM' },
        [String(LIFI_SOLANA_ID)]: { id: String(LIFI_SOLANA_ID), name:'Solana', chainType:'SVM' },
      };
      throw e;
    });
  return _chainsLoading;
};

const FALLBACK_CHAIN_COLORS = {
  '1':     '#627eea',
  '56':    '#f0b90b',
  '137':   '#8247e5',
  '42161': '#28a0f0',
  '10':    '#ff0420',
  '43114': '#e84142',
  '8453':  '#0052ff',
  '59144': '#61dfff',
  '324':   '#8c8dfc',
  '100':   '#04795b',
  [String(LIFI_SOLANA_ID)]: '#14f195',
};
const chainColorOf = (chain) =>
  (chain && FALLBACK_CHAIN_COLORS[chain.id]) || C.accent;

/* ─── TOKENS (live from LI.FI) ─── */

let _tokensCache = null, _tokensLoading = null;
const loadAllTokens = () => {
  if (_tokensCache)   return Promise.resolve(_tokensCache);
  if (_tokensLoading) return _tokensLoading;
  _tokensLoading = fetch('/api/lifi/tokens')
    .then(r => (r.ok ? r.json() : { tokens: {} }))
    .then(j => {
      const byChain = {};
      for (const [cid, tokens] of Object.entries(j?.tokens || {})) {
        byChain[String(cid)] = (tokens || []).filter(t => t.address && t.symbol).map(t => ({
          chainId:  String(cid),
          address:  t.address,
          symbol:   t.symbol,
          name:     t.name || t.symbol,
          decimals: +t.decimals || 0,
          logoURI:  t.logoURI || null,
          priceUSD: t.priceUSD || null,
        }));
      }
      _tokensCache = byChain;
      _tokensLoading = null;
      return byChain;
    })
    .catch(e => { _tokensLoading = null; throw e; });
  return _tokensLoading;
};

/* SOL price lookup from cached LI.FI tokens. Returns null if unknown. */
const getSolPriceUSD = () => {
  const solTokens = _tokensCache?.[String(LIFI_SOLANA_ID)] || [];
  const sol = solTokens.find(t =>
    t.address === SOL_NATIVE || t.address === WSOL_MINT ||
    t.symbol?.toUpperCase() === 'SOL'
  );
  const p = sol?.priceUSD ? Number(sol.priceUSD) : null;
  return Number.isFinite(p) && p > 0 ? p : null;
};

/* ─── LI.FI QUOTE ─── */

const lifiQuote = async ({ fromChainId, fromMint, toChainId, toAddress, amount, sender, receiver, signal }) => {
  if (!sender) throw new Error('Connect wallet first');
  const p = new URLSearchParams({
    fromChain:   String(fromChainId),
    toChain:     String(toChainId),
    fromToken:   lifiFromToken(fromMint),
    toToken:     toAddress,
    fromAmount:  String(amount),
    fromAddress: sender,
    toAddress:   receiver || sender,
    slippage:    String(SLIPPAGE),
    order:       'FASTEST',
    skipSimulation: 'true',
  });
  const r = await fetch('/api/lifi/quote?' + p.toString(), { signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = j?.message || j?.errors?.[0]?.message || j?.error || `HTTP ${r.status}`;
    throw new Error(detail);
  }
  return j;
};

/* ─── FEE CALCULATION ─── *
 *
 * Returns the SOL fee in lamports given the bridge input's USD value.
 * Falls back to MIN_FEE_LAMPORTS if USD value or SOL price is unknown.
 */
const computeSolFeeLamports = (fromAmountUSD, solPriceUSD) => {
  if (!fromAmountUSD || !solPriceUSD || fromAmountUSD <= 0 || solPriceUSD <= 0) {
    return MIN_FEE_LAMPORTS;
  }
  const feeUSD = fromAmountUSD * (FEE_BPS / 10000);
  const feeSOL = feeUSD / solPriceUSD;
  const lamports = Math.floor(feeSOL * LAMPORTS_PER_SOL);
  return Math.max(lamports, MIN_FEE_LAMPORTS);
};

/* ─── ATOMIC TX BUILDER ─── *
 *
 * Decompiles LI.FI's bridge tx, prepends a SOL fee transfer ix,
 * recompiles to a v0 transaction sharing the same ALTs and blockhash.
 */
const buildAtomicTx = async ({
  connection, payer, bridgeTxBase64, feeLamports, blockhash,
}) => {
  // 1) Deserialize LI.FI's bridge tx
  const bridgeTx = VersionedTransaction.deserialize(Buffer.from(bridgeTxBase64, 'base64'));

  // 2) Resolve any ALTs the bridge tx references
  const altLookups = bridgeTx.message.addressTableLookups || [];
  let alts = [];
  if (altLookups.length > 0) {
    const altKeys = altLookups.map(l => l.accountKey);
    const infos = await connection.getMultipleAccountsInfo(altKeys);
    alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
      key:   k,
      state: AddressLookupTableAccount.deserialize(infos[i].data),
    }) : null).filter(Boolean);
    if (alts.length !== altKeys.length) {
      throw new Error('Could not resolve all address lookup tables for bridge tx');
    }
  }

  // 3) Decompile to a regular message we can edit
  const decompiled = TransactionMessage.decompile(bridgeTx.message, {
    addressLookupTableAccounts: alts,
  });

  // 4) Prepend the SOL fee transfer. Going at index 0 means the fee leaves
  //    the user's wallet before LI.FI's bridge ix touches anything — and
  //    if the bridge ix reverts later in the tx, the fee transfer reverts
  //    atomically with it.
  const feeIx = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey:   FEE_WALLET,
    lamports:   feeLamports,
  });
  decompiled.instructions = [feeIx, ...decompiled.instructions];
  decompiled.recentBlockhash = blockhash;
  decompiled.payerKey = payer;

  // 5) Recompile to v0 with the same ALTs
  const newMessage = decompiled.compileToV0Message(alts);
  return new VersionedTransaction(newMessage);
};

/* ─── DEFAULTS ─── */

const DEFAULT_FROM = {
  chainId:  String(LIFI_SOLANA_ID),
  mint:     WSOL_MINT,
  address:  WSOL_MINT,
  symbol:   'SOL',
  name:     'Solana',
  decimals: 9,
  logoURI:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const DEFAULT_TO = {
  chainId:  '1',
  address:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol:   'USDC',
  name:     'USD Coin',
  decimals: 6,
  logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

/* ─── HOOKS ─── */

let _bl = 0;
const useBodyScrollLock = open => {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bl === 0) document.body.classList.add('nexus-scroll-locked');
    _bl++;
    return () => {
      _bl = Math.max(0, _bl - 1);
      if (_bl === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
};
const useEscape = (open, h) => {
  useEffect(() => {
    if (!open) return;
    const fn = e => { if (e.key === 'Escape') { e.stopPropagation(); h?.(); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, h]);
};

/* ─── UI BITS ─── */

const TokenIcon = ({ token, size = 32 }) => {
  const [err, setErr] = useState(false);
  if (token?.logoURI && !err) {
    return (
      <img
        src={token.logoURI}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }}
        onError={() => setErr(true)}
      />
    );
  }
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(0,229,255,.1)',
      border: '1px solid rgba(0,229,255,.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, color: C.accent,
    }}>{ch}</div>
  );
};

const ChainBadge = ({ chain, small = false }) => {
  if (!chain) return null;
  const color = chainColorOf(chain);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: color + '22',
      border: '1px solid ' + color + '55',
      borderRadius: 6,
      padding: small ? '2px 6px' : '3px 8px',
      fontSize: small ? 9 : 10,
      color, fontWeight: 700,
      fontFamily: 'Syne, sans-serif',
    }}>
      <div style={{
        width: small ? 5 : 6, height: small ? 5 : 6,
        borderRadius: '50%', background: color,
      }}/>
      {chain.name}
    </div>
  );
};

const StepProgress = ({ step }) => {
  if (step <= 0) return null;
  const steps = [
    { label: 'Quote',  id: 1 },
    { label: 'Sign',   id: 2 },
    { label: 'Bridge', id: 3 },
    { label: 'Done',   id: 4 },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '14px 0 10px' }}>
      {steps.map((s, i) => {
        const done   = step > s.id;
        const active = step === s.id;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
                background: done ? C.green : active ? C.accent : C.card3,
                color: (done || active) ? '#000' : C.muted,
                border: active ? '2px solid ' + C.accent
                      : done   ? '2px solid ' + C.green
                      :          '2px solid ' + C.muted2,
              }}>{done ? '✓' : s.id}</div>
              <div style={{
                fontSize: 9, marginTop: 3, fontWeight: 700,
                color: done ? C.green : active ? C.accent : C.muted,
              }}>{s.label}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                height: 2, flex: 1, marginBottom: 14,
                background: done ? C.green : C.muted2,
              }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* ─── FROM (Solana) MODAL ─── */

const FromTokenModal = ({ open, onClose, onSelect }) => {
  const [q, setQ]     = useState('');
  const [r, setR]     = useState([]);
  const [loading, setL] = useState(false);

  useEffect(() => {
    if (!open) return;
    setL(true);
    loadAllTokens().finally(() => setL(false));
  }, [open]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    const solTokens = (_tokensCache?.[String(LIFI_SOLANA_ID)] || []).map(tk => ({
      ...tk,
      mint: tk.address,
    }));
    if (!t) { setR([]); return; }
    const tm = setTimeout(() => {
      setR(solTokens
        .filter(tk =>
          tk.symbol?.toLowerCase().includes(t) ||
          tk.name?.toLowerCase().includes(t)   ||
          tk.address?.toLowerCase().includes(t)
        )
        .slice(0, 50));
    }, 150);
    return () => clearTimeout(tm);
  }, [q]);

  const close = useCallback(() => { setQ(''); setR([]); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);

  const popular = [
    DEFAULT_FROM,
    {
      chainId:  String(LIFI_SOLANA_ID),
      mint:     USDC_SOLANA,
      address:  USDC_SOLANA,
      symbol:   'USDC',
      name:     'USD Coin',
      decimals: 6,
      logoURI:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    },
  ];
  const display = q.trim() ? r : popular;

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }}/>
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
        borderRadius: 18, width: '94vw', maxWidth: 440,
        maxHeight: 'min(85vh,100dvh)', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,.95)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Syne, sans-serif' }}>
              From <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· Solana</span>
            </div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading tokens…</div>}
          {!q.trim() && !loading && (
            <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700 }}>POPULAR</div>
          )}
          {display.length === 0 && !loading && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>No matches</div>
          )}
          {display.map((t, i) => (
            <div
              key={(t.mint || t.address || '') + i}
              onClick={() => { onSelect({ ...t, mint: t.address || t.mint }); close(); }}
              style={{
                padding: '12px 16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                borderBottom: '1px solid rgba(255,255,255,.03)',
              }}
            >
              <TokenIcon token={t} size={32}/>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{t.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

/* ─── TO (any chain) MODAL ─── */

const ToTokenModal = ({ open, onClose, onSelect, chains }) => {
  const [q, setQ]       = useState('');
  const [tokens, setTokens] = useState([]);
  const [r, setR]       = useState([]);
  const [loading, setL] = useState(false);
  const [sel, setSel]   = useState('all');

  useEffect(() => {
    if (!open) return;
    setL(true);
    loadAllTokens()
      .then(byChain => {
        const all = [];
        for (const [cid, list] of Object.entries(byChain)) {
          if (String(cid) === String(LIFI_SOLANA_ID)) continue;
          for (const t of list) all.push(t);
        }
        setTokens(all);
      })
      .finally(() => setL(false));
  }, [open]);

  const chainChips = useMemo(() => {
    const seen = new Set(tokens.map(t => t.chainId));
    const order = ['1', '56', '137', '42161', '10', '43114', '8453', '324', '59144', '100'];
    const all = Array.from(seen);
    const known   = all.filter(c => order.includes(c)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const others  = all.filter(c => !order.includes(c)).sort((a, b) => {
      const an = chains?.[a]?.name || a;
      const bn = chains?.[b]?.name || b;
      return an.localeCompare(bn);
    });
    return ['all', ...known, ...others];
  }, [tokens, chains]);

  useEffect(() => {
    const t    = q.trim().toLowerCase();
    const filt = sel === 'all' ? tokens : tokens.filter(tk => tk.chainId === sel);
    if (!t) {
      setR(filt
        .filter(tk => ['USDC', 'USDT', 'ETH', 'BNB', 'MATIC', 'AVAX', 'WETH', 'DAI', 'WBTC', 'BTC'].includes(tk.symbol?.toUpperCase()))
        .slice(0, 30));
      return;
    }
    const tm = setTimeout(() => {
      setR(filt
        .filter(tk =>
          tk.symbol?.toLowerCase().includes(t) ||
          tk.name?.toLowerCase().includes(t)   ||
          tk.address?.toLowerCase().includes(t)
        )
        .slice(0, 60));
    }, 150);
    return () => clearTimeout(tm);
  }, [q, tokens, sel]);

  const close = useCallback(() => { setQ(''); setR([]); setSel('all'); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscape(open, close);

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }}/>
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi,
        borderRadius: 18, width: '94vw', maxWidth: 460,
        maxHeight: 'min(88vh,100dvh)', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,.95)',
      }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Syne, sans-serif' }}>
              To <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· All Chains</span>
            </div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', background: C.card2, border: '1px solid ' + C.border,
              borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13,
              outline: 'none', marginBottom: 10, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {chainChips.map(id => {
              const active = sel === id;
              const chain  = chains?.[id];
              const color  = id === 'all' ? C.accent : (chain ? chainColorOf(chain) : C.muted);
              return (
                <button
                  key={id}
                  onClick={() => setSel(id)}
                  style={{
                    flexShrink: 0, padding: '4px 10px', borderRadius: 20,
                    border: active ? '1px solid ' + color : '1px solid ' + C.muted2,
                    background: active ? color + '22' : 'transparent',
                    color: active ? color : C.muted,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {id === 'all' ? 'All' : (chain?.name || ('Chain ' + id))}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading tokens…</div>}
          {!loading && r.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>No matches</div>
          )}
          {r.map((t, i) => (
            <div
              key={t.chainId + ':' + t.address + i}
              onClick={() => { onSelect(t); close(); }}
              style={{
                padding: '11px 16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                borderBottom: '1px solid rgba(255,255,255,.03)',
              }}
            >
              <TokenIcon token={t} size={30}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                <div style={{
                  color: C.muted, fontSize: 11,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.name}</div>
              </div>
              <ChainBadge chain={chains?.[t.chainId] || { id: t.chainId, name: 'Chain ' + t.chainId }} small/>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

/* ═══════════ MAIN ═══════════ */

export default function CrossChain({ onConnectWallet }) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const pubkey = publicKey || null;
  const wcon   = !!connected && !!pubkey;

  const [chains, setChains]       = useState(null);
  const [chainsLoading, setChainsLoading] = useState(true);

  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken,   setToToken]   = useState(DEFAULT_TO);
  const [fromAmt,   setFromAmt]   = useState('');
  const [destAddr,  setDestAddr]  = useState('');
  const [addrErr,   setAddrErr]   = useState('');

  const [quote,    setQuote]    = useState(null);
  const [quoting,  setQuoting]  = useState(false);
  const [quoteErr, setQuoteErr] = useState('');

  const [step,      setStep]      = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [swapErr,   setSwapErr]   = useState('');
  const [txSig,     setTxSig]     = useState(null);
  const [pendingMsg, setPendingMsg] = useState(null);

  const [sbl, setSbl] = useState(null);
  const [ssb, setSsb] = useState(null);

  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen,   setToOpen]   = useState(false);

  const reqIdRef = useRef(0);

  /* preload caches */
  useEffect(() => {
    loadChains()
      .then(c => { setChains(c); setChainsLoading(false); })
      .catch(() => { setChains(_chainsCache); setChainsLoading(false); });
    loadAllTokens().catch(() => {});
  }, []);

  const toChain = chains?.[String(toToken?.chainId)] || null;
  const toChainType = toChain?.chainType || 'EVM';
  const needsDest = toToken && String(toToken.chainId) !== String(LIFI_SOLANA_ID);

  /* balances */
  useEffect(() => {
    if (!pubkey || !connection) { setSbl(null); setSsb(null); return; }
    let cancelled = false;
    connection.getBalance(pubkey)
      .then(b => { if (!cancelled) setSbl(b); })
      .catch(() => {});
    if (fromToken?.mint && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(fromToken.mint) })
        .then(a => {
          if (cancelled) return;
          setSsb(a.value.length
            ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount
            : 0);
        })
        .catch(() => {});
    } else {
      setSsb(null);
    }
    return () => { cancelled = true; };
  }, [pubkey, connection, fromToken, step]);

  const fbd = useMemo(() => {
    if (fromToken?.mint === WSOL_MINT) return sbl != null ? sbl / LAMPORTS_PER_SOL : null;
    return ssb;
  }, [fromToken, sbl, ssb]);

  /* address validation */
  useEffect(() => {
    if (!needsDest || !destAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateDest(destAddr, toChainType) || '');
  }, [destAddr, toChainType, needsDest]);

  /* QUOTE — FULL amount (no fee deduction). User bridges 100% of input;
   * fee comes from their separate SOL balance. */
  const fetchQuote = useCallback(async () => {
    setQuoteErr('');
    if (!fromAmt || +fromAmt <= 0 || !fromToken || !toToken) { setQuote(null); return; }
    if (!pubkey) { setQuote(null); setQuoteErr('Connect a wallet to see a quote'); return; }

    const myReq = ++reqIdRef.current;
    setQuoting(true);

    try {
      const dec = fromToken.decimals;
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') { setQuote(null); setQuoting(false); return; }

      const sender   = pubkey.toString();
      const userDest = destAddr.trim();
      const userDestOk = userDest && !validateDest(userDest, toChainType);
      const receiver = userDestOk
        ? userDest
        : (toChainType === 'EVM' ? '0x000000000000000000000000000000000000dEaD' : sender);

      const j = await lifiQuote({
        fromChainId: LIFI_SOLANA_ID,
        fromMint:    fromToken.mint || fromToken.address,
        toChainId:   toToken.chainId,
        toAddress:   toToken.address,
        amount:      raw,
        sender, receiver,
      });
      if (myReq !== reqIdRef.current) return;

      if (!j?.estimate) throw new Error('No route available');
      const outAmt = Number(j.estimate.toAmountMin || j.estimate.toAmount) /
                     Math.pow(10, toToken.decimals);
      const fromUSD = Number(j.estimate.fromAmountUSD) || 0;
      const solPrice = getSolPriceUSD();
      const feeLamports = computeSolFeeLamports(fromUSD, solPrice);
      const feeSOL = feeLamports / LAMPORTS_PER_SOL;
      const feeUSD = solPrice ? feeSOL * solPrice : null;

      setQuote({
        outAmt,
        outDisplay: fmtTok(outAmt),
        estTime:    j.estimate.executionDuration || null,
        bridge:     j.toolDetails?.name || j.tool || 'LI.FI',
        raw:        j,
        rawAmount:  raw,
        feeLamports,
        feeSOL,
        feeUSD,
        fromUSD,
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (myReq === reqIdRef.current) {
        setQuote(null);
        setQuoteErr(friendlyError(e));
      }
    } finally {
      if (myReq === reqIdRef.current) setQuoting(false);
    }
  }, [fromAmt, fromToken, toToken, destAddr, pubkey, toChainType]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  /* MAX */
  const onMax = useCallback(() => {
    if (fbd == null || fbd <= 0) return;
    const dec = Math.min(fromToken.decimals, 9);
    if (fromToken?.mint === WSOL_MINT) {
      // Reserve network fee + estimated platform fee (use min fee as safe lower bound).
      const reserveLamports = SOL_RESERVE + MIN_FEE_LAMPORTS;
      setFromAmt(fmtInput(Math.max(0, (sbl - reserveLamports)) / LAMPORTS_PER_SOL, dec));
    } else {
      setFromAmt(fmtInput(fbd, dec));
    }
  }, [fbd, fromToken, sbl]);

  /* SOL-balance check for non-SOL inputs. The fee is paid in SOL even when
   * bridging USDC/etc., so the user needs separate SOL for it + network fees. */
  const solShortfall = useMemo(() => {
    if (!quote || sbl == null) return null;
    const need = quote.feeLamports + SOL_RESERVE;
    // When input IS SOL, the input amount already comes out of SOL balance,
    // so we need to check separately that the input + fee + reserve fit.
    if (fromToken?.mint === WSOL_MINT) {
      const inputLamports = Math.floor(Number(fromAmt) * LAMPORTS_PER_SOL);
      const total = inputLamports + quote.feeLamports + SOL_RESERVE;
      return sbl < total ? (total - sbl) : 0;
    }
    return sbl < need ? (need - sbl) : 0;
  }, [quote, sbl, fromToken, fromAmt]);

  /* EXECUTE — atomic single tx */
  const execute = useCallback(async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (needsDest) {
      const e = validateDest(destAddr, toChainType);
      if (e) { setAddrErr(e); return; }
    }
    if (!quote) { setSwapErr('No route. Wait for routing.'); return; }
    if (!signTransaction) {
      setSwapErr('Wallet does not support signing. Use Phantom or Solflare.');
      return;
    }
    if (solShortfall && solShortfall > 0) {
      setSwapErr(`Not enough SOL — need ~${(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL to cover the platform + network fee.`);
      return;
    }

    setStep(1);
    setSwapErr('');
    setStatusMsg('Building route…');
    setTxSig(null);
    setPendingMsg(null);

    try {
      const dec = fromToken.decimals;
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') throw new Error('Invalid amount');

      const sender   = pubkey.toString();
      const receiver = needsDest ? destAddr.trim() : sender;
      const fromMint = fromToken.mint || fromToken.address;

      // 1) Fresh LI.FI quote at execute time (full amount, no fee deduction).
      const j = await lifiQuote({
        fromChainId: LIFI_SOLANA_ID,
        fromMint, toChainId: toToken.chainId, toAddress: toToken.address,
        amount: raw, sender, receiver,
      });
      const txData = j?.transactionRequest?.data;
      if (!txData) throw new Error('LI.FI returned no transaction');

      // 2) Compute fee in SOL from this fresh quote's USD value.
      const fromUSD = Number(j?.estimate?.fromAmountUSD) || quote.fromUSD || 0;
      const solPrice = getSolPriceUSD();
      const feeLamports = computeSolFeeLamports(fromUSD, solPrice);

      // 3) Fresh blockhash, then build the atomic tx.
      setStatusMsg('Combining bridge + fee into one transaction…');
      const latest = await connection.getLatestBlockhash('confirmed');
      const tx = await buildAtomicTx({
        connection, payer: pubkey,
        bridgeTxBase64: txData,
        feeLamports,
        blockhash: latest.blockhash,
      });

      // 4) Simulate the EXACT bytes the wallet will sign.
      const mapSimErr = (logs) => {
        const t = (logs || []).join('\n').toLowerCase();
        if (t.includes('insufficient') || t.includes('0x1')) return 'Insufficient balance (need SOL for fee + bridge).';
        if (t.includes('slippage') || t.includes('0x1771'))  return 'Price moved — try a smaller amount or wait a moment.';
        if (t.includes('account not') || t.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (t.includes('blockhash') || t.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Bridge simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[crosschain] sim non-fatal', simErr);
      }

      // 5) Sign — one popup, wallet sees full tx including fee transfer.
      setStep(2);
      setStatusMsg('Sign in wallet…');
      const signed = await signTransaction(tx);

      // 6) Broadcast.
      setStep(3);
      setStatusMsg('Submitting transaction…');
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false, maxRetries: 3,
      });
      setTxSig(sig);

      // 7) Confirm with polling fallback.
      let bridgeOk = false;
      try {
        const result = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 35_000)),
        ]);
        bridgeOk = !result?.value?.err;
        if (result?.value?.err) throw new Error('Bridge tx failed on-chain: ' + JSON.stringify(result.value.err));
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { bridgeOk = true; break; }
            if (st?.value?.err) throw new Error('Bridge tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      if (bridgeOk) {
        setStep(4);
        setStatusMsg('');
      } else {
        setStep(4);
        setStatusMsg('');
        setPendingMsg('Submitted but still confirming. Check Solscan for status.');
      }
    } catch (e) {
      console.error('[CrossChain]', e);
      setSwapErr(friendlyError(e));
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 6000);
    }
  }, [
    wcon, needsDest, destAddr, toToken, fromToken, fromAmt,
    pubkey, signTransaction, connection, quote, onConnectWallet, toChainType, solShortfall,
  ]);

  const reset = useCallback(() => {
    setStep(0); setStatusMsg(''); setSwapErr(''); setTxSig(null); setPendingMsg(null);
    setFromAmt(''); setQuote(null); setQuoteErr('');
  }, []);

  /* derived */
  const tuv = quote?.raw?.estimate?.toAmountUSD ? Number(quote.raw.estimate.toAmountUSD) : 0;
  const fromUsd = quote?.fromUSD || 0;
  const busy      = step > 0 && step < 4 && step !== -1;
  const isSuccess = step === 4;
  const isError   = step === -1;
  const solscan   = txSig ? 'https://solscan.io/tx/' + txSig : null;

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1)   return 'Building Route…';
    if (step === 2)   return 'Sign in Wallet…';
    if (step === 3)   return 'Bridging…';
    if (isSuccess)    return pendingMsg ? 'Submitted ✓' : 'Bridge Submitted ✓';
    if (isError)      return 'Try Again';
    if (!fromAmt)     return 'Enter Amount';
    if (needsDest && !destAddr.trim()) return 'Enter Destination';
    if (addrErr)      return 'Invalid Address';
    if (!quote)       return quoting ? 'Finding Route…' : 'No Route';
    if (solShortfall) return 'Need more SOL';
    return `Bridge ${fromToken?.symbol || ''} → ${toToken?.symbol || ''}`;
  };
  const btnDisabled = busy ||
    (wcon && (!fromAmt || (needsDest && !destAddr.trim()) || !!addrErr ||
              (!quote && !isError && !isSuccess) || !!solShortfall));
  const btnBg = () => {
    if (isSuccess)            return C.successGrad;
    if (isError)              return 'rgba(255,59,107,.2)';
    if (btnDisabled && wcon)  return C.card2;
    return C.buyGrad;
  };

  const fromChain = chains?.[String(LIFI_SOLANA_ID)] || { id: String(LIFI_SOLANA_ID), name: 'Solana', chainType: 'SVM' };
  const toChainDisplay = chains?.[String(toToken?.chainId)] || { id: toToken?.chainId, name: 'Chain ' + toToken?.chainId };

  return (
    <div style={{ width: '100%', maxWidth: 540, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>
          Cross-Chain
        </h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 4, fontFamily: 'Syne, sans-serif' }}>
          Solana → Any Chain · powered by LI.FI
          {!chainsLoading && chains && (
            <span style={{ marginLeft: 6 }}>· {Object.keys(chains).length} chains supported</span>
          )}
        </p>
      </div>

      <div style={{
        background: C.card, border: '1px solid ' + C.border,
        borderRadius: 20, padding: 20,
      }}>
        <StepProgress step={step}/>

        {/* FROM */}
        <div style={{
          background: C.card2, borderRadius: 14, padding: 16,
          border: '1px solid ' + C.border, marginBottom: 4,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>YOU SEND</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ChainBadge chain={fromChain} small/>
              {fbd != null && (
                <span style={{ fontSize: 11, color: C.muted }}>
                  Bal: <span style={{ color: C.text }}>{fmtTok(fbd)}</span>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => !busy && setFromOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: C.card3, border: '1px solid ' + C.border,
                borderRadius: 12, padding: '9px 12px',
                cursor: busy ? 'default' : 'pointer',
                flexShrink: 0, minWidth: 110,
              }}
            >
              <TokenIcon token={fromToken} size={22}/>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{fromToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <input
              value={fromAmt}
              onChange={e => { if (!busy) setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
              placeholder="0.00"
              inputMode="decimal"
              disabled={busy}
              style={{
                flex: 1, background: 'transparent', border: 'none',
                fontSize: 24, color: '#fff', textAlign: 'right', outline: 'none',
                fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.5 : 1,
              }}
            />
            {fbd > 0 && !busy && (
              <button
                onClick={onMax}
                style={{
                  background: 'rgba(0,229,255,.12)',
                  border: '1px solid rgba(0,229,255,.25)',
                  borderRadius: 6, padding: '6px 10px',
                  color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >MAX</button>
            )}
          </div>
          {fromUsd > 0 && (
            <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
              {fmtUsd(fromUsd)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: C.card3, border: '1px solid ' + C.border,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.accent, fontSize: 16,
          }}>↓</div>
        </div>

        {/* TO */}
        <div style={{
          background: C.card2, borderRadius: 14, padding: 16,
          border: '1px solid ' + C.border,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>YOU RECEIVE (EST.)</span>
            {toToken && <ChainBadge chain={toChainDisplay} small/>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => !busy && setToOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: C.card3, border: '1px solid ' + C.border,
                borderRadius: 12, padding: '9px 12px',
                cursor: busy ? 'default' : 'pointer',
                flexShrink: 0, minWidth: 110,
              }}
            >
              <TokenIcon token={toToken} size={22}/>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{toToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <div style={{
              flex: 1, textAlign: 'right', fontSize: 24,
              color: quote ? C.green : C.muted2,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {quoting
                ? <span style={{ fontSize: 14, color: C.muted }}>…</span>
                : (quote?.outDisplay || '0')}
            </div>
          </div>
          {tuv > 0 && (
            <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>
              {fmtUsd(tuv)}
            </div>
          )}
          {quote && (
            <div style={{
              marginTop: 8, fontSize: 10, color: C.muted,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>via {quote.bridge}</span>
              {quote.estTime && <span>~{Math.max(1, Math.ceil(quote.estTime / 60))} min</span>}
            </div>
          )}
        </div>

        {needsDest && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 6 }}>
              DESTINATION{' '}
              <span style={{ color: chainColorOf(toChainDisplay), fontWeight: 400 }}>
                · {toChainDisplay?.name}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                value={destAddr}
                onChange={e => { if (!busy) setDestAddr(e.target.value.trim()); }}
                placeholder={
                  toChainType === 'EVM'  ? '0x...'
                  : toChainType === 'SVM' ? 'Solana address'
                  : toChainType === 'UTXO' ? 'bc1... / 1... / 3...'
                  : toChainType === 'MVM' ? '0x... (64 hex)'
                  : 'Destination address'
                }
                disabled={busy}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: C.card2,
                  border: '1px solid ' + (addrErr ? C.red : destAddr && !addrErr ? C.green : C.border),
                  borderRadius: 10, padding: '12px 14px',
                  color: '#fff', fontSize: 13, outline: 'none',
                  fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.5 : 1,
                }}
              />
              {destAddr && !addrErr && (
                <div style={{
                  position: 'absolute', right: 12, top: '50%',
                  transform: 'translateY(-50%)', color: C.green, fontSize: 14,
                }}>✓</div>
              )}
            </div>
            {addrErr && <div style={{ marginTop: 5, fontSize: 11, color: C.red }}>{addrErr}</div>}
          </div>
        )}

        {quoteErr && !quote && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: 'rgba(255,149,0,.08)',
            border: '1px solid rgba(255,149,0,.2)',
            borderRadius: 8, fontSize: 12, color: '#ff9500',
          }}>{quoteErr}</div>
        )}

        {quote && fromAmt && (
          <div style={{
            marginTop: 14, background: '#050912', borderRadius: 12,
            padding: 14, border: '1px solid ' + C.border,
          }}>
            {[
              ['Route',        quote.bridge],
              ['Platform fee', `${quote.feeSOL.toFixed(4)} SOL` + (quote.feeUSD ? ` (${fmtUsd(quote.feeUSD)})` : '')],
              ['Slippage',     (SLIPPAGE * 100).toFixed(1) + '%'],
              ['Est. time',    quote.estTime ? '~' + Math.max(1, Math.ceil(quote.estTime / 60)) + ' min' : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11 }}>
                <span style={{ color: C.muted }}>{k}</span>
                <span style={{ color: C.text }}>{v}</span>
              </div>
            ))}
            {fromToken?.mint !== WSOL_MINT && (
              <div style={{
                marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + C.border,
                fontSize: 10, color: C.muted, lineHeight: 1.4,
              }}>
                Fee paid in SOL from your wallet — you bridge 100% of your {fromToken?.symbol}.
              </div>
            )}
          </div>
        )}

        {solShortfall > 0 && quote && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: 'rgba(255,149,0,.08)',
            border: '1px solid rgba(255,149,0,.2)',
            borderRadius: 8, fontSize: 12, color: '#ff9500',
          }}>
            You need ~{(solShortfall / LAMPORTS_PER_SOL).toFixed(4)} more SOL in your wallet to cover the platform fee.
          </div>
        )}

        {statusMsg && busy && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: 'rgba(0,229,255,.06)',
            border: '1px solid rgba(0,229,255,.15)',
            borderRadius: 8, fontSize: 12, color: C.accent,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              border: '2px solid rgba(0,229,255,.3)',
              borderTopColor: C.accent,
              animation: 'wc-spin 0.8s linear infinite',
              flexShrink: 0,
            }}/>
            {statusMsg}
          </div>
        )}

        {swapErr && (
          <div style={{
            marginTop: 10, padding: '10px 12px',
            background: 'rgba(255,59,107,.1)',
            border: '1px solid rgba(255,59,107,.3)',
            borderRadius: 8, fontSize: 12, color: C.red,
          }}>{swapErr}</div>
        )}

        {isSuccess && (
          <div style={{
            marginTop: 10, padding: 14,
            background: pendingMsg ? 'rgba(255,193,7,.06)' : 'rgba(0,255,163,.06)',
            border: pendingMsg ? '1px solid rgba(255,193,7,.2)' : '1px solid rgba(0,255,163,.2)',
            borderRadius: 10, textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{pendingMsg ? '⏳' : '🎉'}</div>
            <div style={{ color: pendingMsg ? '#ffc107' : C.green, fontWeight: 700, fontSize: 14 }}>
              {pendingMsg ? 'Bridge Submitted' : 'Bridge Submitted!'}
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
              {pendingMsg || (quote?.estTime
                ? 'Funds arrive in ~' + Math.max(1, Math.ceil(quote.estTime / 60)) + ' min'
                : 'Funds arrive in a few minutes')}
            </div>
          </div>
        )}

        {!isSuccess ? (
          <button
            onClick={isError ? reset : (!wcon ? () => onConnectWallet?.() : execute)}
            disabled={btnDisabled && !isError}
            style={{
              width: '100%', marginTop: 16, padding: 16,
              borderRadius: 14, border: 'none',
              background: btnBg(),
              color: (btnDisabled && wcon) ? C.muted2 : '#fff',
              fontFamily: 'Syne, sans-serif',
              fontWeight: 800, fontSize: 15,
              cursor: btnDisabled ? 'not-allowed' : 'pointer',
              minHeight: 54, opacity: busy ? 0.8 : 1,
            }}
          >
            {busy && (
              <span style={{
                marginRight: 8, display: 'inline-block',
                animation: 'wc-spin 0.8s linear infinite',
              }}>⟳</span>
            )}
            {btnLabel()}
          </button>
        ) : (
          <button
            onClick={reset}
            style={{
              width: '100%', marginTop: 16, padding: 16,
              borderRadius: 14, border: 'none',
              background: C.card3, color: C.accent,
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', minHeight: 54,
            }}
          >New Swap</button>
        )}

        {txSig && solscan && (
          <a
            href={solscan}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block', textAlign: 'center', marginTop: 10,
              fontSize: 12, color: C.accent,
            }}
          >View on Solscan ↗</a>
        )}
        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 14 }}>
          Non-custodial · LI.FI aggregator · Solana origin
        </p>
      </div>

      <FromTokenModal
        open={fromOpen}
        onClose={() => setFromOpen(false)}
        onSelect={t => { setFromToken(t); setQuote(null); }}
      />
      <ToTokenModal
        open={toOpen}
        onClose={() => setToOpen(false)}
        onSelect={t => { setToToken(t); setQuote(null); setDestAddr(''); setAddrErr(''); }}
        chains={chains}
      />
    </div>
  );
}
