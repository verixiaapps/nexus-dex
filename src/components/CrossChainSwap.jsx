// SwapWidget.jsx — atomic single-transaction Jupiter swap.
//
// CHANGES (visual only — all trading/RPC logic preserved exactly):
//   • CSS combined inline as SW_CSS + useSwCSS injector (no SwapWidget.css)
//   • Theme switched from mint/cyan to cyan #00e5ff + pink #ff4d9d
//     so the widget feels native under the homepage SwapHero.
//   • Fonts normalized to Syne + JetBrains Mono (matches App.jsx).
//   • All Jupiter routing, fee logic, RPC pool, simulate/sign/send flow
//     UNCHANGED. Same sw- class prefix so any external references hold.

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
// INLINE CSS — Syne + JetBrains Mono · cyan + pink to match SwapHero
// =====================================================================
const SW_CSS = `
.sw-root{
  --sw-bg:#03060f; --sw-bg-2:#080d1a;
  --sw-panel:#101015; --sw-panel-hi:#15151c; --sw-panel-deep:#1a1a22;
  --sw-border:rgba(255,255,255,.07); --sw-border-hi:rgba(255,255,255,.14);
  --sw-text:#f5fafe; --sw-text-dim:#9b8fc0; --sw-text-faint:#564670;
  --sw-cyan:#00e5ff; --sw-cyan-hi:#7df6ff;
  --sw-pink:#ff4d9d; --sw-pink-hi:#ffa3ce;
  --sw-green:#00ffa3; --sw-red:#ff3b6b; --sw-amber:#f59e0b;
  --sw-cyan-line:rgba(0,229,255,.32); --sw-pink-line:rgba(255,77,157,.32);
  --sw-cyan-bg:rgba(0,229,255,.06); --sw-cyan-bg2:rgba(0,229,255,.18);
  --sw-pink-bg:rgba(255,77,157,.06); --sw-pink-bg2:rgba(255,77,157,.18);
  background:transparent;
  color:var(--sw-text);
  font-family:'Syne',system-ui,-apple-system,sans-serif;
}
.sw-root,.sw-root *{box-sizing:border-box}

.sw-container{max-width:480px;margin:0 auto;padding:0}

/* HEADER */
.sw-header{display:flex;justify-content:space-between;align-items:center;padding:0 4px 12px;margin-top:-4px}
.sw-title{font-family:'Syne',sans-serif;font-weight:800;font-size:20px;margin:0;letter-spacing:-.01em;color:var(--sw-text)}
.sw-live-pill{display:flex;align-items:center;gap:6px;border:1px solid var(--sw-cyan-line);background:var(--sw-cyan-bg);color:var(--sw-cyan);font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 11px;border-radius:100px;font-weight:800;letter-spacing:.08em}
.sw-live-dot{width:5px;height:5px;border-radius:50%;background:var(--sw-cyan);box-shadow:0 0 8px var(--sw-cyan);animation:swPulse 1.6s ease-in-out infinite}
@keyframes swPulse{50%{opacity:.4}}
@keyframes swSpin{to{transform:rotate(360deg)}}
@keyframes swShimmer{0%{left:-110px}50%,100%{left:130%}}
@keyframes swHueShift{to{background-position:200% 0}}
@keyframes swFadeIn{from{opacity:0}to{opacity:1}}
@keyframes swModalIn{from{opacity:0;transform:translateY(20px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}

/* PANEL */
.sw-panel{background:linear-gradient(180deg,var(--sw-panel-hi),var(--sw-panel));border:1.5px solid var(--sw-border);border-radius:22px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.03)}

/* SWAP ROW */
.sw-row{background:var(--sw-panel-hi);border:1.5px solid var(--sw-border);border-radius:14px;padding:14px;transition:border-color .15s,box-shadow .15s}
.sw-row:focus-within{border-color:var(--sw-cyan-line);box-shadow:0 0 0 3px rgba(0,229,255,.08)}
.sw-row+.sw-row{margin-top:0}
.sw-row-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px}
.sw-row-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--sw-text-dim);font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.sw-balance{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--sw-text-dim);font-weight:600;display:flex;align-items:center;gap:6px}
.sw-balance b{color:var(--sw-text);font-weight:800}
.sw-max-btn{background:var(--sw-cyan-bg);border:1px solid var(--sw-cyan-line);color:var(--sw-cyan);padding:3px 8px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;cursor:pointer;letter-spacing:.1em;transition:all .15s}
.sw-max-btn:hover{background:var(--sw-cyan-bg2);box-shadow:0 0 10px rgba(0,229,255,.2)}
.sw-row-mid{display:flex;align-items:center;gap:10px}

/* TOKEN BUTTON */
.sw-token-btn{display:flex;align-items:center;gap:7px;padding:9px 12px;background:linear-gradient(135deg,var(--sw-panel-deep),var(--sw-panel));border:1.5px solid var(--sw-border-hi);border-radius:999px;color:var(--sw-text);font-family:'Syne',sans-serif;font-size:13px;font-weight:800;cursor:pointer;transition:all .15s;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.25),inset 0 -1px 0 rgba(0,0,0,.15)}
.sw-token-btn:hover{border-color:var(--sw-cyan);box-shadow:0 2px 12px rgba(0,229,255,.15),inset 0 -1px 0 rgba(0,0,0,.15)}
.sw-token-btn:active{transform:translateY(1px)}
.sw-token-logo{width:20px;height:20px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.05);object-fit:cover;background:#1a1a22}

/* AMOUNT INPUT */
.sw-amount-input{flex:1;background:transparent;border:none;outline:none;color:var(--sw-text);font-family:'Syne',sans-serif;font-size:26px;text-align:right;font-weight:900;letter-spacing:-.02em;min-width:0;width:100%;font-variant-numeric:tabular-nums}
.sw-amount-input::placeholder{color:var(--sw-text-faint);font-weight:700}

/* FLIP */
.sw-flip-wrap{display:flex;justify-content:center;margin:-6px 0;position:relative;z-index:2}
.sw-flip-btn{background:linear-gradient(135deg,var(--sw-cyan),var(--sw-pink));border:3px solid var(--sw-panel);border-radius:12px;width:40px;height:40px;display:grid;place-items:center;cursor:pointer;color:#0a0a0c;transition:transform .25s cubic-bezier(0.2,1.3,0.4,1);box-shadow:0 4px 18px rgba(255,77,157,.35),inset 0 -2px 0 rgba(0,0,0,.15)}
.sw-flip-btn:hover{transform:rotate(180deg)}
.sw-flip-btn:active{transform:rotate(180deg) scale(.92)}

/* DETAILS */
.sw-details{margin-top:12px;padding:12px 14px;background:rgba(0,0,0,.30);border:1px solid var(--sw-border);border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:11px}
.sw-detail-row{display:flex;justify-content:space-between;padding:4px 0;font-weight:700;gap:8px}
.sw-detail-row>span:first-child{color:var(--sw-text-dim);font-weight:600}
.sw-detail-val{color:var(--sw-text);font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.sw-impact-neutral{color:var(--sw-text-dim)}
.sw-impact-good{color:var(--sw-green)}
.sw-impact-warn{color:var(--sw-amber)}
.sw-impact-bad{color:var(--sw-red)}

/* BANNERS */
.sw-banner{margin-top:12px;padding:12px 14px;border-radius:14px;font-size:13px;font-weight:600;border:1.5px solid;font-family:'Syne',sans-serif}
.sw-banner-error{background:rgba(255,59,107,.08);border-color:rgba(255,59,107,.3);color:#ffa9bd}
.sw-banner-success{background:rgba(0,255,163,.08);border-color:rgba(0,255,163,.3);color:#86efac}
.sw-banner-pending{background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.3);color:#fcd34d}
.sw-banner-link{color:#fff;text-decoration:underline;font-weight:800;font-family:'JetBrains Mono',monospace}

/* PRIMARY CTA */
.sw-primary-btn{width:100%;margin-top:14px;padding:18px 0;background:linear-gradient(90deg,var(--sw-cyan) 0%,#fff 50%,var(--sw-pink) 100%);background-size:300% 100%;animation:swHueShift 5s linear infinite;border:none;border-radius:14px;color:#03060f;font-family:'Syne',sans-serif;font-size:15px;font-weight:900;letter-spacing:.04em;cursor:pointer;position:relative;overflow:hidden;transition:all .15s cubic-bezier(0.2,1.2,0.4,1);box-shadow:0 10px 30px -8px rgba(255,77,157,.5),0 4px 14px rgba(0,229,255,.3),inset 0 2px 0 rgba(255,255,255,.4),inset 0 -2px 0 rgba(0,0,0,.15)}
.sw-primary-btn::after{content:'';position:absolute;top:0;bottom:0;width:70px;left:-110px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:swShimmer 2.8s ease-in-out infinite;pointer-events:none}
.sw-primary-btn:active:not(.sw-disabled){transform:translateY(3px)}
.sw-primary-btn.sw-disabled{background:linear-gradient(135deg,#2a2a35,#1f1f28);color:var(--sw-text-faint);cursor:not-allowed;animation:none;box-shadow:0 4px 12px rgba(0,0,0,.3),inset 0 -2px 0 rgba(0,0,0,.2)}
.sw-primary-btn.sw-disabled::after{display:none}

/* FOOTER */
.sw-footer{margin-top:14px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--sw-text-faint);text-align:center;font-weight:600;letter-spacing:.02em}
.sw-footer b{color:var(--sw-cyan);font-weight:800}

/* MODAL */
.sw-modal-overlay{position:fixed;inset:0;background:rgba(3,6,15,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;padding:0;z-index:1000;animation:swFadeIn .2s}
@media(min-width:640px){.sw-modal-overlay{align-items:center;padding:16px}}
.sw-modal-card{width:100%;max-width:480px;max-height:85dvh;background:linear-gradient(180deg,var(--sw-panel-hi),var(--sw-panel));border:1.5px solid var(--sw-border-hi);border-top:1.5px solid var(--sw-cyan-line);border-radius:22px 22px 0 0;color:var(--sw-text);display:flex;flex-direction:column;box-shadow:0 -20px 60px rgba(0,0,0,.7);animation:swModalIn .3s cubic-bezier(0.2,1.2,0.4,1)}
@media(min-width:640px){.sw-modal-card{border-radius:22px}}
.sw-modal-head{padding:18px;border-bottom:1px solid var(--sw-border)}
.sw-modal-head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.sw-modal-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;margin:0;letter-spacing:-.01em;color:var(--sw-text)}
.sw-icon-btn{background:rgba(255,255,255,.05);border:1px solid var(--sw-border);border-radius:10px;width:36px;height:36px;display:grid;place-items:center;cursor:pointer;color:var(--sw-text);transition:all .15s}
.sw-icon-btn:hover{background:rgba(255,255,255,.1);transform:rotate(90deg)}
.sw-modal-search{width:100%;padding:12px 14px;background:var(--sw-panel-deep);border:1.5px solid var(--sw-border);border-radius:12px;color:var(--sw-text);font-size:14px;outline:none;font-family:'Syne',sans-serif;font-weight:500;transition:border-color .15s}
.sw-modal-search:focus{border-color:var(--sw-cyan);box-shadow:0 0 0 3px rgba(0,229,255,.1)}
.sw-modal-search::placeholder{color:var(--sw-text-faint)}
.sw-modal-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px;padding-bottom:calc(env(safe-area-inset-bottom) + 14px)}
.sw-modal-msg{padding:18px;color:var(--sw-text-dim);text-align:center;font-weight:600;font-size:13px;font-family:'Syne',sans-serif}
.sw-token-row{width:100%;display:flex;align-items:center;gap:12px;padding:10px 12px;background:transparent;border:1.5px solid transparent;border-radius:12px;cursor:pointer;color:var(--sw-text);text-align:left;font-family:'Syne',sans-serif;transition:all .15s}
.sw-token-row:hover{background:var(--sw-panel-deep);border-color:var(--sw-border-hi)}
.sw-token-row:active{transform:scale(.99)}
.sw-token-row-logo{width:34px;height:34px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,.04);object-fit:cover;background:#1a1a22}
.sw-token-row-placeholder{width:34px;height:34px;border-radius:50%;background:var(--sw-panel-deep);flex-shrink:0}
.sw-token-row-info{flex:1;min-width:0}
.sw-token-row-sym{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;letter-spacing:-.01em;color:var(--sw-text)}
.sw-token-row-name{font-size:12px;color:var(--sw-text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;margin-top:2px}
.sw-token-row-bal{text-align:right;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:13px;color:var(--sw-cyan);flex-shrink:0}
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

/* ─── CONFIG ──────────────────────────────────────────────────────── */
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 300;
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_MINT  = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const PRIORITY_FEE_MICROLAMPORTS = 50_000;
const SLIPPAGE_BPS = 500;

const RUNTIME_CFG = (typeof window !== 'undefined' && window.__VERIXIA_CONFIG__) || {};
const RPC_POOL = [
  RUNTIME_CFG.rpc,
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

const BAL_COMMITMENT = 'processed';

const _connCache = new Map();
const getConn = (url, commitment) => {
  const key = url + '|' + commitment;
  let c = _connCache.get(key);
  if (!c) { c = new Connection(url, commitment); _connCache.set(key, c); }
  return c;
};

const rpcRace = (label, op, commitment = BAL_COMMITMENT) => {
  const conns = RPC_POOL.map(u => getConn(u, commitment));
  return Promise.any(conns.map((c, i) =>
    op(c).catch(e => {
      console.warn(`[rpc] ${label} failed on ${RPC_POOL[i]}:`, e?.message);
      throw e;
    })
  )).catch(() => { throw new Error(`${label}: all RPCs failed`); });
};

/* ─── HELPERS ─────────────────────────────────────────────────────── */
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
  const connection = useMemo(() => getConn(RPC_POOL[0], 'confirmed'), []);

  const [tokens, setTokens]               = useState([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  const [inputMint,  setInputMint]   = useState(defaultInputMint  || SOL_MINT);
  const [outputMint, setOutputMint]  = useState(defaultOutputMint || USDC_MINT);
  const [amount,     setAmount]      = useState('');

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

  /* tokens */
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

  /* balances */
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

  /* QUOTE */
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

  return (
    <div className="sw-root">
      <div className="sw-container">

        <div className="sw-header">
          <h1 className="sw-title">Swap</h1>
          <div className="sw-live-pill">
            <span className="sw-live-dot"></span>
            LIVE
          </div>
        </div>

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
            <button onClick={flip} className="sw-flip-btn" aria-label="Flip tokens"><FlipIcon/></button>
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
              <Row label="Platform fee">{(FEE_BPS / 100).toFixed(1)}% (in {inputToken.symbol})</Row>
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
            {swapping
              ? 'Swapping…'
              : !wallet.publicKey
                ? 'Connect Wallet'
                : inputMint === outputMint
                  ? 'Select different tokens'
                  : !amount || Number(amount) <= 0
                    ? 'Enter amount'
                    : !quote && quoting
                      ? 'Getting quote…'
                      : !quote
                        ? 'No route available'
                        : !hasFunds
                          ? `Insufficient ${inputToken?.symbol || ''}`
                          : '🚀 Swap'}
          </button>

          <p className="sw-footer">
            Powered by <b>Jupiter</b> · Solana's leading DEX aggregator
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

/* ─── SUB-COMPONENTS ────────────────────────────────────────── */

function SwapRow({
  label, token, amount, onAmountChange, onPickerOpen,
  balance, balLoading, balError, onRefresh, walletConnected,
  onMax, editable,
}) {
  return (
    <div className="sw-row">
      <div className="sw-row-top">
        <span className="sw-row-label">{label}</span>
        {walletConnected && (
          <span className="sw-balance">
            {balLoading
              ? 'Balance: …'
              : balError
                ? <span style={{ color: '#ffa9bd' }}>{balError}</span>
                : balance
                  ? <>Balance: <b>{fmtAmount(balance.uiAmount, balance.decimals)}</b></>
                  : <>Balance: <b>0</b></>
            }
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="sw-max-btn"
                style={{ marginLeft: 6 }}
                aria-label="Refresh balance"
              >
                ↻
              </button>
            )}
            {editable && onMax && balance && balance.uiAmount > 0 && !balLoading && (
              <button onClick={onMax} className="sw-max-btn">MAX</button>
            )}
          </span>
        )}
      </div>
      <div className="sw-row-mid">
        <button onClick={onPickerOpen} className="sw-token-btn">
          {token?.logoURI && (
            <img
              src={token.logoURI}
              alt=""
              className="sw-token-logo"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span>{token?.symbol || 'Select'}</span>
          <ChevronIcon/>
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
            <h3 className="sw-modal-title">Select Token</h3>
            <button onClick={onClose} className="sw-icon-btn"><CloseIcon/></button>
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

/* ─── ICONS ────────────────────────────────────────────────── */

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const FlipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="7 13 12 18 17 13"/>
    <polyline points="7 6 12 11 17 6"/>
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6"  y2="18"/>
    <line x1="6"  y1="6" x2="18" y2="18"/>
  </svg>
);
