// SwapWidget.jsx — atomic single-transaction Jupiter swap.
//    
// VISUAL REDESIGN — Wonderland-light, sky+pink accents to match the
// new conversion-first homepage. All trading/RPC/Jupiter logic preserved
// verbatim. Class prefix stays sw-.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useWallet } from '@solana/wallet-adapter-react';

// =====================================================================
// INLINE CSS — Wonderland-light: Instrument Serif + Space Grotesk + JetBrains Mono
// Accent: sky #A0E7FF → pink #FF8FBE (matches App.jsx homepage)
// =====================================================================
const SW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.sw-root{
  --ink:#0b0b0c; --ink-2:#86868b; --ink-3:#aeaeb2;
  --border:#e9e9eb; --hairline:#f1f1f2; --fill:#f4f4f5; --fill-2:#fafafa;
  --green:#16c08a; --greent:#11b87f; --red:#f0425a; --amber:#a67200; --blue:#2f6bff;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink);-webkit-font-smoothing:antialiased;
}
.sw-root *{box-sizing:border-box}
.sw-root .num,.sw-amount-input,.sw-row-usd,.sw-balance,.sw-detail-val,.sw-token-row-bal,.sw-token-sym,.sw-token-row-sym{font-variant-numeric:tabular-nums}

.sw-container{max-width:440px;margin:0 auto;padding:0 4px}

.sw-panel{background:#fff;border:1px solid var(--hairline);border-radius:20px;box-shadow:0 1px 2px rgba(11,11,12,.04);padding:7px;position:relative}

.sw-row{background:var(--fill-2);border:1px solid transparent;border-radius:15px;padding:13px 14px}
.sw-row+.sw-row{margin-top:5px}
.sw-row:focus-within{border-color:#0b0b0c;background:#fff}
.sw-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sw-row-label{font-size:11px;font-weight:700;color:var(--ink-2)}
.sw-row-mid{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}
.sw-row-usd{font-size:11px;font-weight:600;color:var(--ink-3);margin-top:5px}
.sw-balance{font-size:11px;font-weight:600;color:var(--ink-3)}
.sw-max-btn{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--ink);background:var(--fill);border:none;border-radius:7px;padding:4px 8px;margin-left:7px;cursor:pointer;transition:.14s}
.sw-max-btn:hover{background:#ececee}

.sw-amount-input{flex:1;min-width:0;border:none;background:none;outline:none;font-family:inherit;font-size:28px;font-weight:800;letter-spacing:-.02em;color:var(--ink);padding:0;width:100%}
.sw-amount-input::placeholder{color:var(--ink-3);font-weight:800}
.sw-amount-input:read-only{color:var(--ink)}

.sw-token-btn{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:6px 11px 6px 6px;font-family:inherit;cursor:pointer;flex-shrink:0;box-shadow:0 1px 2px rgba(11,11,12,.04);transition:.14s}
.sw-token-btn:hover{border-color:var(--ink-3)}
.sw-token-btn:active{transform:scale(.97)}
.sw-token-logo{width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--fill)}
.sw-token-fallback{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--fill);color:var(--ink-2);font-size:11px;font-weight:800;flex-shrink:0}
.sw-token-sym{font-size:14px;font-weight:800;color:var(--ink);letter-spacing:-.01em}
.sw-token-caret{color:var(--ink-3);font-size:10px;margin-left:1px}

.sw-flip-wrap{position:relative;height:0;display:flex;justify-content:center;z-index:2}
.sw-flip-btn{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:11px;background:#fff;border:1px solid var(--border);display:grid;place-items:center;color:#0b0b0c;font-size:15px;cursor:pointer;box-shadow:0 2px 6px rgba(11,11,12,.10);transition:.14s}
.sw-flip-btn:hover{border-color:var(--ink-3)}
.sw-flip-btn:active{transform:translateY(-50%) rotate(180deg)}

.sw-details{margin:8px 6px 2px;display:flex;flex-direction:column;gap:7px}
.sw-detail-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:600;color:var(--ink-2)}
.sw-detail-val{font-weight:700;color:var(--ink)}
.sw-impact-good{color:var(--greent)}
.sw-impact-neutral{color:var(--ink-2)}
.sw-impact-warn{color:var(--amber)}
.sw-impact-bad{color:var(--red)}

.sw-primary-btn{width:100%;margin-top:8px;height:50px;border:none;border-radius:15px;background:#0b0b0c;color:#fff;font-family:inherit;font-size:16px;font-weight:800;letter-spacing:-.01em;cursor:pointer;transition:.14s;display:flex;align-items:center;justify-content:center;gap:8px}
.sw-primary-btn:hover{opacity:.92}
.sw-primary-btn:active{transform:translateY(1px)}
.sw-primary-btn.sw-disabled{background:var(--fill);color:var(--ink-3);cursor:not-allowed;transform:none;opacity:1}

.sw-banner{margin-top:8px;border-radius:12px;padding:11px 13px;font-size:12px;font-weight:600;line-height:1.4;display:flex;align-items:center;gap:9px}
.sw-banner-error{background:rgba(240,66,90,.07);border:1px solid rgba(240,66,90,.22);color:var(--red)}
.sw-banner-pending{background:rgba(47,107,255,.06);border:1px solid rgba(47,107,255,.20);color:var(--blue)}
.sw-banner-success{background:rgba(22,192,138,.08);border:1px solid rgba(22,192,138,.24);color:var(--greent)}
.sw-banner-link{color:inherit;font-weight:800;text-decoration:underline;cursor:pointer}

.sw-icon-btn{width:34px;height:34px;border-radius:10px;background:var(--fill);border:none;display:grid;place-items:center;color:var(--ink-2);cursor:pointer;transition:.14s;flex-shrink:0}
.sw-icon-btn:hover{background:#ececee;color:var(--ink)}

.sw-footer{text-align:center;font-size:10.5px;font-weight:600;color:var(--ink-3);margin-top:12px;font-variant-numeric:tabular-nums}

/* token picker modal */
.sw-modal-overlay{position:fixed;inset:0;background:rgba(11,11,12,.32);backdrop-filter:blur(4px);z-index:1200;display:flex;align-items:flex-end;justify-content:center;padding:0}
.sw-modal-card{width:100%;max-width:480px;max-height:80vh;background:#fff;border-radius:22px 22px 0 0;border:1px solid var(--hairline);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -8px 40px rgba(11,11,12,.18)}
.sw-modal-head{padding:18px 18px 10px}
.sw-modal-head-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.sw-modal-title{font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--ink)}
.sw-modal-search{width:100%;border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-family:inherit;font-size:14px;font-weight:500;color:var(--ink);background:var(--fill-2);outline:none}
.sw-modal-search::placeholder{color:var(--ink-3)}
.sw-modal-search:focus{border-color:#0b0b0c;background:#fff}
.sw-modal-list{flex:1;overflow-y:auto;padding:4px 8px 16px}
.sw-modal-msg{text-align:center;font-size:13px;font-weight:600;color:var(--ink-3);padding:28px 16px}

.sw-token-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:13px;cursor:pointer;transition:.1s}
.sw-token-row:hover{background:var(--fill-2)}
.sw-token-row:active{background:var(--fill);transform:scale(.99)}
.sw-token-row-logo{width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--fill)}
.sw-token-row-placeholder{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--fill);color:var(--ink-2);font-size:14px;font-weight:800;flex-shrink:0}
.sw-token-row-info{flex:1;min-width:0}
.sw-token-row-name{font-size:14px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw-token-row-sym{font-size:11.5px;font-weight:600;color:var(--ink-3);margin-top:1px}
.sw-token-row-bal{font-size:13px;font-weight:700;color:var(--ink);flex-shrink:0;text-align:right}
`;

function useSwCSS() {
  useEffect(() => {
    const id = 'nexus-sw-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = SW_CSS;
    document.head.appendChild(el);
  }, []);
}



/* ─── CONFIG ──────────────────────────────────────────── */
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const SLIPPAGE_BPS = 500;

// ── RPC ──────────────────────────────────────────────────────────────
// Same-origin server proxy → Alchemy mainnet. server.js holds the API
// key and forwards via /api/solana-rpc. All Connection instances route
// through the proxy.
const RPC_URL = (typeof window !== 'undefined' && window.location)
  ? window.location.origin + '/api/solana-rpc'
  : 'http://localhost:3001/api/solana-rpc';
const BAL_COMMITMENT = 'processed';


const _connCache = new Map();
const getConn = (commitment) => {
  let c = _connCache.get(commitment);
  if (!c) { c = new Connection(RPC_URL, commitment); _connCache.set(commitment, c); }
  return c;
};

// Single RPC, no fallback. Kept the name + signature so call sites don't need
// to change — the `label` arg is now unused (we used to log which pool URL
// failed; with one URL there's nothing to disambiguate).
const rpcRace = (label, op, commitment = BAL_COMMITMENT) =>
  op(getConn(commitment));

/* ─── HELPERS — UNCHANGED ─────────────────────────────────────────── */
const fmtAmount = (n, decimals = 6) => {
  if (n == null || isNaN(n)) return '0';
  const num = Number(n);
  if (num === 0) return '0';
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1)        return num.toFixed(Math.min(6, decimals));
  if (num < 1000)     return num.toFixed(Math.min(4, decimals));
  if (num < 1_000_000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (num / 1_000_000).toFixed(2) + 'M';
};

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired')) return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled')) return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route')) return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large')) return 'Route is too complex to fit in one transaction. Try a different amount or token.';
  return err?.message || 'Swap failed. Please try again.';
};

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

/* ─── COMPONENT ───────────────────────────────────────────────────── */
export default function SwapWidget({ defaultInputMint, defaultOutputMint, onConnectWallet } = {}) {
  useSwCSS();

  const wallet = useWallet();
  const connection = useMemo(() => getConn('confirmed'), []);

  const [tokens, setTokens]               = useState([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  const [inputMint,  setInputMint]   = useState(defaultInputMint  || SOL_MINT);
  const [outputMint, setOutputMint]  = useState(defaultOutputMint || USDC_MINT);
  // CONVERSION LEVER: prefill 0.5 SOL so cold visitors see an immediate live quote
  // and a glowing CTA in the first second. Empty input == friction.
  const [amount,     setAmount]      = useState('0.5');

  const [showPicker, setShowPicker] = useState(null);

  const [quote, setQuote]           = useState(null);
  const [quoting, setQuoting]       = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  const [swapping, setSwapping]     = useState(false);
  const [swapError, setSwapError]   = useState(null);
  const [swapResult, setSwapResult] = useState(null);

  const [balances, setBalances] = useState({});
  const [balLoading, setBalLoading] = useState(false);
  const [balError, setBalError] = useState(null);

  /* tokens — UNCHANGED */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/jupiter/tokens');
        const data = await r.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.tokens || []);
        const norm = list.map(t => ({
          address:  t.id || t.address || t.mint,
          symbol:   t.symbol,
          name:     t.name,
          decimals: t.decimals,
          logoURI:  t.icon || t.logoURI || null,
        })).filter(t => t.address && t.symbol && t.decimals != null);
        setTokens(norm);
      } catch (e) {
        console.warn('[swap] token list failed', e);
        setTokens([
          { address: SOL_MINT,  symbol: 'SOL',  name: 'Solana',   decimals: 9, logoURI: null },
          { address: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: null },
        ]);
      } finally {
        if (!cancelled) setTokensLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* balances — UNCHANGED */
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); setBalError(null); return; }
    setBalLoading(true);
    setBalError(null);
    const owner = wallet.publicKey;

    const mergeAccs = (into, accs) => {
      if (!accs || !accs.value) return;
      for (const acc of accs.value) {
        const info = acc.account?.data?.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const amt = info.tokenAmount?.amount;
        const dec = info.tokenAmount?.decimals;
        const uiAmt = info.tokenAmount?.uiAmount;
        if (!mint || amt == null) continue;
        into[mint] = { amount: Number(amt), decimals: dec, uiAmount: uiAmt };
      }
    };

    const solP = rpcRace('getBalance', c => c.getBalance(owner, BAL_COMMITMENT))
      .then(lamports => {
        setBalances(prev => {
          const next = { ...prev };
          delete next.__rpc_failed;
          next[SOL_MINT] = { amount: lamports, decimals: 9, uiAmount: lamports / 1e9 };
          return next;
        });
      })
      .catch(e => console.warn('[swap] SOL balance failed', e?.message));

    const tokP = rpcRace('tokenAccs', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, BAL_COMMITMENT)
    ).then(accs => {
      setBalances(prev => {
        const next = { ...prev };
        delete next.__rpc_failed;
        mergeAccs(next, accs);
        return next;
      });
    }).catch(e => console.warn('[swap] SPL accounts failed', e?.message));

    const tok22P = rpcRace('tokenAccs2022', c =>
      c.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, BAL_COMMITMENT)
    ).then(accs => {
      setBalances(prev => {
        const next = { ...prev };
        mergeAccs(next, accs);
        return next;
      });
    }).catch(e => console.warn('[swap] Token-2022 accounts failed', e?.message));

    const results = await Promise.allSettled([solP, tokP, tok22P]);
    if (results.every(r => r.status === 'rejected')) {
      setBalances({ __rpc_failed: true });
      setBalError('RPC unreachable — tap retry');
    }
    setBalLoading(false);
  }, [wallet.publicKey]);

  useEffect(() => { refreshBalances(); }, [refreshBalances, inputMint]);

  const inputToken  = useMemo(() => tokens.find(t => t.address === inputMint)  || null, [tokens, inputMint]);
  const outputToken = useMemo(() => tokens.find(t => t.address === outputMint) || null, [tokens, outputMint]);
  const inputBalance = balances[inputMint];

  const rawAmount = useMemo(() => {
    if (!amount || !inputToken) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputToken.decimals)).toString();
  }, [amount, inputToken]);

  /* QUOTE — UNCHANGED */
  const quoteAbortRef = useRef(null);
  useEffect(() => {
    if (!rawAmount || inputMint === outputMint) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    const ac = new AbortController();
    quoteAbortRef.current = ac;

    setQuoting(true);
    setQuoteError(null);

    const t = setTimeout(async () => {
      try {
        const net = (BigInt(rawAmount) * BigInt(10000 - FEE_BPS)) / 10000n;
        if (net <= 0n) {
          setQuote(null);
          setQuoting(false);
          return;
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount:      net.toString(),
          slippageBps: String(SLIPPAGE_BPS),
          taker:       wallet.publicKey
            ? wallet.publicKey.toBase58()
            : '11111111111111111111111111111111',
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) {
          setQuote(data);
          setQuoteError(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setQuote(null);
          setQuoteError(friendlyError(e));
        }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);

    return () => { clearTimeout(t); ac.abort(); };
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => {
    if (!quote || !outputToken) return null;
    return Number(quote.outAmount) / Math.pow(10, outputToken.decimals);
  }, [quote, outputToken]);

  const minReceived = useMemo(() => {
    if (!quote || !outputToken) return null;
    return Number(quote.otherAmountThreshold) / Math.pow(10, outputToken.decimals);
  }, [quote, outputToken]);

  const priceImpact = useMemo(() => {
    if (!quote || quote.priceImpactPct == null) return null;
    const n = Number(quote.priceImpactPct);
    return Number.isFinite(n) ? n * (Math.abs(n) <= 1 ? 100 : 1) : null;
  }, [quote]);

  const flip = () => {
    setInputMint(outputMint);
    setOutputMint(inputMint);
    setAmount('');
    setQuote(null);
  };

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
    setAmount(String(maxAmt));
  };

  /* SWAP — UNCHANGED */
  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet (Phantom, Solflare, Backpack).');
      return;
    }
    if (!quote || !outputToken || !inputToken) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);
    setSwapResult(null);

    try {
      const dec = inputToken.decimals;
      const build = quote;

      const feeAmount = (BigInt(rawAmount) * BigInt(FEE_BPS)) / 10000n;
      if (feeAmount <= 0n) throw new Error('Fee amount rounds to zero — amount too small.');

      const feeIxs = [];
      if (inputMint === SOL_MINT) {
        feeIxs.push(SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey:   FEE_WALLET,
          lamports:   Number(feeAmount),
        }));
      } else {
        const mintPk = new PublicKey(inputMint);
        const mintInfo = await connection.getAccountInfo(mintPk);
        if (!mintInfo) throw new Error('Input mint not found on-chain.');
        const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        const sourceAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProgram);
        const destAta   = getAssociatedTokenAddressSync(mintPk, FEE_WALLET,       true, tokenProgram);

        feeIxs.push(createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey, destAta, FEE_WALLET, mintPk, tokenProgram,
        ));
        feeIxs.push(createTransferCheckedInstruction(
          sourceAta, mintPk, destAta, wallet.publicKey,
          feeAmount, dec, [], tokenProgram,
        ));
      }

      const ixs = [];
      if (Array.isArray(build.computeBudgetInstructions))
        for (const ix of build.computeBudgetInstructions) ixs.push(deserIx(ix));

      for (const ix of feeIxs) ixs.push(ix);

      if (Array.isArray(build.setupInstructions))
        for (const ix of build.setupInstructions) ixs.push(deserIx(ix));
      if (build.swapInstruction) ixs.push(deserIx(build.swapInstruction));
      if (build.cleanupInstruction) ixs.push(deserIx(build.cleanupInstruction));
      if (Array.isArray(build.otherInstructions))
        for (const ix of build.otherInstructions) ixs.push(deserIx(ix));

      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs,
      }).compileToV0Message(alts);
      const tx = new VersionedTransaction(message);

      const mapSimErr = (logs) => {
        const j = (logs || []).join('\n').toLowerCase();
        if (j.includes('insufficient') || j.includes('0x1')) return 'Insufficient balance for this swap.';
        if (j.includes('slippage') || j.includes('0x1771'))  return 'Price moved — try a higher slippage or smaller amount.';
        if (j.includes('account not') || j.includes('uninitialized')) return 'Token account not ready. Try again in a moment.';
        if (j.includes('blockhash') || j.includes('expired')) return 'Quote expired. Please refresh and retry.';
        return null;
      };
      try {
        const sim = await connection.simulateTransaction(tx, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        if (sim.value.err) {
          throw new Error(mapSimErr(sim.value.logs) || 'Swap simulation failed — the price may have moved.');
        }
      } catch (simErr) {
        if (simErr?.message && /balance|slippage|simulation failed|account not|expired/i.test(simErr.message)) {
          throw simErr;
        }
        console.warn('[swap] sim non-fatal', simErr);
      }

      const signed = await wallet.signTransaction(tx);

      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      try {
        const conf = await Promise.race([
          connection.confirmTransaction({
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }, 'confirmed'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('confirm-timeout')), 30_000)),
        ]);
        if (conf?.value?.err) throw new Error('Swap tx failed on-chain: ' + JSON.stringify(conf.value.err));
        confirmed = true;
      } catch (cfErr) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
            const cs = st?.value?.confirmationStatus;
            if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break; }
            if (st?.value?.err) throw new Error('Swap tx failed on-chain.');
          } catch (e) {
            if (/failed on-chain/i.test(String(e.message))) throw e;
          }
        }
      }

      setSwapResult({ signature: sig, pending: !confirmed });

      if (confirmed) {
        setAmount('');
        setQuote(null);
        setTimeout(() => refreshBalances(), 2000);
      }
    } catch (e) {
      console.error('[swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    wallet, quote, outputToken, inputToken,
    inputMint, outputMint, rawAmount,
    refreshBalances, connection,
  ]);

  const hasFunds = inputBalance && Number(amount) > 0 && inputBalance.uiAmount >= Number(amount);
  const canSwap  = !!wallet.publicKey && !!quote && !quoting && !swapping &&
                   Number(amount) > 0 && inputMint !== outputMint && hasFunds;

  const priceImpactClass = priceImpact == null ? 'sw-impact-neutral'
    : priceImpact > 5 ? 'sw-impact-bad'
    : priceImpact > 1 ? 'sw-impact-warn'
    : 'sw-impact-good';

  // CTA label — emphasize the trade in italic serif when ready
  let ctaContent;
  if (swapping)                            ctaContent = 'Swapping…';
  else if (!wallet.publicKey)              ctaContent = 'Connect Wallet';
  else if (inputMint === outputMint)       ctaContent = 'Select different tokens';
  else if (!amount || Number(amount) <= 0) ctaContent = 'Enter amount';
  else if (!quote && quoting)              ctaContent = 'Getting quote…';
  else if (!quote)                         ctaContent = 'No route available';
  else if (!hasFunds)                      ctaContent = `Insufficient ${inputToken?.symbol || ''}`;
  else {
    const outDisp = outAmountUi != null ? fmtAmount(outAmountUi, outputToken?.decimals) : '';
    ctaContent = (<>Swap {amount} {inputToken?.symbol} <b>→</b> {outDisp} {outputToken?.symbol}</>);
  }

  return (
    <div className="sw-root">
      <div className="sw-container">

        <div className="sw-panel">
          <SwapRow
            label="You Pay"
            token={inputToken}
            amount={amount}
            onAmountChange={setAmount}
            onPickerOpen={() => setShowPicker('input')}
            balance={inputBalance}
            balLoading={balLoading}
            balError={balError}
            onRefresh={refreshBalances}
            walletConnected={!!wallet.publicKey}
            onMax={setMax}
            editable
          />

          <div className="sw-flip-wrap">
            <button onClick={flip} className="sw-flip-btn" aria-label="Flip tokens">↓</button>
          </div>

          <SwapRow
            label="You Receive"
            token={outputToken}
            amount={outAmountUi != null ? fmtAmount(outAmountUi, outputToken?.decimals) : (quoting ? '…' : '')}
            onPickerOpen={() => setShowPicker('output')}
            balance={balances[outputMint]}
            balLoading={balLoading}
            walletConnected={!!wallet.publicKey}
            editable={false}
          />

          {quote && outputToken && inputToken && Number(amount) > 0 && (
            <div className="sw-details">
              <Row label="Rate">
                1 {inputToken.symbol} ≈ {fmtAmount((outAmountUi / Number(amount)) || 0, outputToken.decimals)} {outputToken.symbol}
              </Row>
              <Row label="Min received">
                {fmtAmount(minReceived, outputToken.decimals)} {outputToken.symbol}
              </Row>
              <Row label="Price impact">
                <span className={priceImpactClass}>
                  {priceImpact != null ? `${priceImpact.toFixed(2)}%` : '—'}
                </span>
              </Row>
            </div>
          )}

          {quoteError && !swapping && !swapResult && <Banner kind="error">{quoteError}</Banner>}
          {swapError && <Banner kind="error">{swapError}</Banner>}
          {swapResult && (
            <Banner kind={swapResult.pending ? 'pending' : 'success'}>
              {swapResult.pending ? 'Submitted but still confirming. ' : 'Swap confirmed. '}
              <a
                href={`https://solscan.io/tx/${swapResult.signature}`}
                target="_blank"
                rel="noreferrer"
                className="sw-banner-link"
              >
                View on Solscan
              </a>
            </Banner>
          )}

          <button
            onClick={(!wallet.publicKey && onConnectWallet) ? onConnectWallet : handleSwap}
            disabled={!wallet.publicKey ? !onConnectWallet : !canSwap}
            className={'sw-primary-btn' + ((!wallet.publicKey ? !!onConnectWallet : canSwap) ? '' : ' sw-disabled')}
          >
            {ctaContent}
          </button>

          <p className="sw-footer">
            Powered by <b>Jupiter</b> · <b>$48M</b> daily · <b>12K+</b> tokens
          </p>
        </div>
      </div>

      {showPicker && (
        <TokenPicker
          tokens={tokens}
          loading={tokensLoading}
          balances={balances}
          excludeMint={showPicker === 'input' ? outputMint : inputMint}
          onSelect={(mint) => {
            if (showPicker === 'input') setInputMint(mint);
            else                         setOutputMint(mint);
            setShowPicker(null);
          }}
          onClose={() => setShowPicker(null)}
        />
      )}
    </div>
  );
}

/* ─── SUB-COMPONENTS ────────────────────────────────────────────── */

function SwapRow({
  label, token, amount, onAmountChange, onPickerOpen,
  balance, balLoading, balError, onRefresh, walletConnected,
  onMax, editable,
}) {
  return (
    <div className="sw-row">
      <div className="sw-row-top">
        <span className="sw-row-label">{label}</span>
        {walletConnected ? (
          <span className="sw-balance">
            {balLoading
              ? 'Balance: …'
              : balError
                ? <span style={{ color: '#f0425a' }}>{balError}</span>
                : balance
                  ? <>Balance: <b>{fmtAmount(balance.uiAmount, balance.decimals)}</b></>
                  : <>Balance: <b>0</b></>
            }
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="sw-max-btn"
                style={{ marginLeft: 4 }}
                aria-label="Refresh balance"
              >
                ↻
              </button>
            )}
            {editable && onMax && balance && balance.uiAmount > 0 && !balLoading && (
              <button onClick={onMax} className="sw-max-btn">MAX</button>
            )}
          </span>
        ) : (
          <span className="sw-balance">Balance: <b>—</b></span>
        )}
      </div>
      <div className="sw-row-mid">
        <button onClick={onPickerOpen} className="sw-token-btn">
          {token?.logoURI ? (
            <img
              src={token.logoURI}
              alt=""
              className="sw-token-logo"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <span className="sw-token-fallback">{token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?'}</span>
          )}
          <span className="sw-token-sym">{token?.symbol || 'Select'}</span>
          <span className="sw-token-caret">▾</span>
        </button>
        {editable ? (
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, '');
              const parts = v.split('.');
              if (parts.length > 2) return;
              onAmountChange(v);
            }}
            className="sw-amount-input"
          />
        ) : (
          <input type="text" readOnly value={amount} placeholder="0.00" className="sw-amount-input"/>
        )}
      </div>
    </div>
  );
}

function TokenPicker({ tokens, loading, balances, excludeMint, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(query.trim())}`);
        const data = await r.json();
        const list = Array.isArray(data) ? data : (data?.tokens || []);
        setSearchResults(list.map(t => ({
          address:  t.id || t.address || t.mint,
          symbol:   t.symbol,
          name:     t.name,
          decimals: t.decimals,
          logoURI:  t.icon || t.logoURI || null,
        })).filter(t => t.address && t.symbol && t.decimals != null));
      } catch (e) {
        console.warn('[swap] search failed', e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const list = useMemo(() => {
    const base = searchResults != null
      ? searchResults
      : tokens.filter(t => {
          if (!query.trim()) return true;
          const q = query.toLowerCase();
          return t.symbol.toLowerCase().includes(q) ||
                 t.name.toLowerCase().includes(q)   ||
                 t.address.toLowerCase().startsWith(q);
        });
    return base
      .filter(t => t.address !== excludeMint)
      .sort((a, b) => {
        const ab = balances[a.address]?.uiAmount || 0;
        const bb = balances[b.address]?.uiAmount || 0;
        if (ab > 0 && bb === 0) return -1;
        if (bb > 0 && ab === 0) return 1;
        if (ab !== bb) return bb - ab;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 150);
  }, [tokens, searchResults, query, excludeMint, balances]);

  return (
    <div className="sw-modal-overlay" onClick={onClose}>
      <div className="sw-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="sw-modal-head">
          <div className="sw-modal-head-row">
            <h3 className="sw-modal-title">Select <em>token</em></h3>
            <button onClick={onClose} className="sw-icon-btn">✕</button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol, or paste address"
            className="sw-modal-search"
          />
        </div>
        <div className="sw-modal-list">
          {loading && <div className="sw-modal-msg">Loading tokens…</div>}
          {!loading && list.length === 0 && (
            <div className="sw-modal-msg">{searching ? 'Searching…' : 'No tokens found.'}</div>
          )}
          {list.map(t => {
            const bal = balances[t.address];
            return (
              <button
                key={t.address}
                onClick={() => onSelect(t.address)}
                className="sw-token-row"
              >
                {t.logoURI
                  ? <img src={t.logoURI} alt="" className="sw-token-row-logo"
                         onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                  : <div className="sw-token-row-placeholder" />
                }
                <div className="sw-token-row-info">
                  <div className="sw-token-row-sym">{t.symbol}</div>
                  <div className="sw-token-row-name">{t.name}</div>
                </div>
                {bal && bal.uiAmount > 0 && (
                  <div className="sw-token-row-bal">
                    {fmtAmount(bal.uiAmount, bal.decimals)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="sw-detail-row">
      <span>{label}</span>
      <span className="sw-detail-val">{children}</span>
    </div>
  );
}

function Banner({ kind, children }) {
  return (
    <div className={`sw-banner sw-banner-${kind}`}>{children}</div>
  );
}
