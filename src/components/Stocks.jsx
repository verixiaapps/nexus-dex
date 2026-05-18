import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, Transaction, PublicKey } from '@solana/web3.js';
import { useNexusWallet } from '../WalletContext.js';

// =====================================================================
// CONFIG — xStocks via Jupiter Aggregator. 2.55% platform fee to your
// treasury's USDC ATA. No spread (fully compliant). ExactIn swaps only.
// =====================================================================
const USDC_MINT             = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS         = 6;

const PLATFORM_FEE_BPS      = 255;  // 2.55% — Jupiter accepts uint16 here
// Jupiter handles routing. We pass a generous 5% cap and use dynamicSlippage
// so Jupiter picks the tightest viable slippage per route. No slippage knob
// in the UI — users see real price impact in the quote preview.
const SLIPPAGE_BPS_MAX  = 500;  // 5% — Jupiter dynamicSlippage optimizes within

// Set this once: your treasury wallet's USDC associated token account.
// Compute with: spl-token associated-account <TREASURY_PUBKEY> EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
// All Jupiter fees flow here. Required for live trading.
const TREASURY_USDC_ATA = process.env.REACT_APP_TREASURY_USDC_ATA || '';

const MIN_USDC = 1;
const MAX_USDC = 50_000;

// =====================================================================
// XSTOCKS LIST — verified mints from solana.com/news/case-study-xstocks
// 60+ tickers exist; we ship with the top 18 by relevance + volume.
// Decimals: 8 (Token-2022 standard for xStocks).
// =====================================================================
const STOCKS = [
  // ------ TECH MEGACAPS ------
  { mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', symbol: 'TSLAx',  name: 'Tesla',                 ticker: 'TSLA',  decimals: 8, sector: 'Tech',   color: '#e31837' },
  { mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', symbol: 'AAPLx',  name: 'Apple',                 ticker: 'AAPL',  decimals: 8, sector: 'Tech',   color: '#a2aaad' },
  { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx',  name: 'NVIDIA',                ticker: 'NVDA',  decimals: 8, sector: 'Tech',   color: '#76b900' },
  { mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', symbol: 'METAx',  name: 'Meta Platforms',        ticker: 'META',  decimals: 8, sector: 'Tech',   color: '#0866ff' },
  { mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', symbol: 'GOOGLx', name: 'Alphabet',              ticker: 'GOOGL', decimals: 8, sector: 'Tech',   color: '#4285f4' },
  { mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', symbol: 'AMZNx',  name: 'Amazon',                ticker: 'AMZN',  decimals: 8, sector: 'Tech',   color: '#ff9900' },
  { mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', symbol: 'MSFTx',  name: 'Microsoft',             ticker: 'MSFT',  decimals: 8, sector: 'Tech',   color: '#00a4ef' },
  { mint: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', symbol: 'NFLXx',  name: 'Netflix',               ticker: 'NFLX',  decimals: 8, sector: 'Tech',   color: '#e50914' },
  { mint: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', symbol: 'PLTRx',  name: 'Palantir',              ticker: 'PLTR',  decimals: 8, sector: 'Tech',   color: '#0a0a0a' },
  { mint: 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo', symbol: 'AVGOx',  name: 'Broadcom',              ticker: 'AVGO',  decimals: 8, sector: 'Tech',   color: '#cc092f' },

  // ------ CRYPTO-ADJACENT ------
  { mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', symbol: 'COINx',  name: 'Coinbase',              ticker: 'COIN',  decimals: 8, sector: 'Crypto', color: '#0052ff' },
  { mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx',  name: 'MicroStrategy',         ticker: 'MSTR',  decimals: 8, sector: 'Crypto', color: '#fcb017' },
  { mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', symbol: 'CRCLx',  name: 'Circle',                ticker: 'CRCL',  decimals: 8, sector: 'Crypto', color: '#3399ff' },
  { mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', symbol: 'HOODx',  name: 'Robinhood',             ticker: 'HOOD',  decimals: 8, sector: 'Crypto', color: '#cdff00' },

  // ------ ETFs ------
  { mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', symbol: 'SPYx',   name: 'S&P 500 ETF',           ticker: 'SPY',   decimals: 8, sector: 'ETF',    color: '#1c4f9c' },
  { mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', symbol: 'QQQx',   name: 'Nasdaq 100 ETF',        ticker: 'QQQ',   decimals: 8, sector: 'ETF',    color: '#003b71' },
  { mint: 'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', symbol: 'GLDx',   name: 'Gold Trust',            ticker: 'GLD',   decimals: 8, sector: 'ETF',    color: '#d4af37' },
  { mint: 'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp', symbol: 'TBLLx',  name: '1-3 Month T-Bill ETF',  ticker: 'TBLL',  decimals: 8, sector: 'ETF',    color: '#2a4d6e' },
];

const FILTERS = [
  { id: 'All',      label: 'All' },
  { id: 'Trending', label: 'Trending' },
  { id: 'Tech',     label: 'Tech' },
  { id: 'Crypto',   label: 'Crypto-Adj' },
  { id: 'ETF',      label: 'ETFs' },
];

// =====================================================================
// DESIGN TOKENS — match the rest of the app
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff',
  up:'#3dd598', down:'#ff8a9e',
  amber:'#f5b53d', live:'#ff3d5d', gold:'#ffcd3c',
  border:'rgba(255,255,255,.06)', borderHi:'rgba(151,252,228,.24)',
  hairline:'rgba(255,255,255,.05)',
  glow:'0 0 24px rgba(151,252,228,.18),0 0 48px rgba(151,252,228,.06)',
  shadowLg:'0 20px 60px rgba(0,0,0,.55)',
};
const T = {
  display:{ fontFamily:"'Syne', system-ui, sans-serif" },
  body:   { fontFamily:"'DM Sans', system-ui, sans-serif" },
  mono:   { fontFamily:"'IBM Plex Mono', monospace" },
  hero:   { fontFamily:"'Clash Display', 'Syne', system-ui, sans-serif" },
};

// =====================================================================
// UTILS
// =====================================================================
function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}
function fmtAmt(n, d = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(d);
  return n.toFixed(6);
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidSolAddr(v) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(v || '')); }

// US market hours (informational only — xStocks trade 24/7 regardless)
function getUsMarketStatus() {
  const now = new Date();
  // Convert to Eastern Time using Intl
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
  const parts = fmt.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const day = parts.weekday;
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const timeMin = hour * 60 + minute;
  if (day === 'Sat' || day === 'Sun') return { open: false, label: 'Closed · Weekend' };
  if (timeMin >= 9*60+30 && timeMin < 16*60) return { open: true, label: 'US Market Open' };
  if (timeMin >= 4*60   && timeMin < 9*60+30) return { open: false, label: 'Pre-Market' };
  if (timeMin >= 16*60  && timeMin < 20*60)   return { open: false, label: 'After-Hours' };
  return { open: false, label: 'Closed · Overnight' };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

// Pull live USD prices from Jupiter Price API V3
// V3 response: { [mint]: { usdPrice, blockId, decimals, priceChange24h } }
async function fetchStockPrices(mints) {
  if (!mints.length) return {};
  try {
    const url = `https://api.jup.ag/price/v3?ids=${mints.join(',')}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8_000);
    if (!res.ok) return {};
    const json = await res.json();
    const out = {};
    Object.entries(json || {}).forEach(([mint, info]) => {
      const p = Number(info?.usdPrice);
      if (Number.isFinite(p) && p > 0) out[mint] = p;
    });
    return out;
  } catch (e) {
    console.warn('[jupiter price]', e?.message || e);
    return {};
  }
}

// Get Jupiter quote — buy = USDC → stock, sell = stock → USDC. Always ExactIn.
async function getJupiterQuote({ inputMint, outputMint, amountAtomic, slippageBps }) {
  const params = new URLSearchParams({
    inputMint, outputMint,
    amount:        String(amountAtomic),
    slippageBps:   String(slippageBps),
    platformFeeBps: String(PLATFORM_FEE_BPS),
    swapMode:      'ExactIn',
  });
  const res = await fetchWithTimeout(`/api/jupiter/quote?${params}`, { headers: { Accept: 'application/json' } }, 12_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Quote failed (${res.status})`);
  return json;
}

async function getJupiterSwap({ quoteResponse, userPublicKey, feeAccount }) {
  const body = {
    quoteResponse,
    userPublicKey,
    feeAccount,
    wrapAndUnwrapSol:        true,
    dynamicComputeUnitLimit: true,
    // Reliability stack: cap slippage at 5%, let Jupiter pick the tightest
    // viable slippage at execution time, and pay a high priority fee so the
    // tx lands during congestion.
    dynamicSlippage: { maxBps: SLIPPAGE_BPS_MAX },
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports:   10_000_000,  // cap at 0.01 SOL
        priorityLevel: 'high',
      },
    },
    // xStocks are Token-2022 with Transfer Hook extension; Jupiter's
    // shared-account optimization is built for standard SPL Token and
    // throws IncorrectTokenProgramID (0x177e) without this flag.
    useSharedAccounts: false,
  };
  const res = await fetchWithTimeout('/api/jupiter/swap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, 15_000);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Swap build failed (${res.status})`);
  return json;
}

// =====================================================================
// PRE-WALLET SIMULATION
// Runs the EXACT serialized tx through the Solana RPC's simulateTransaction
// before triggering the wallet. The bytes we sim are byte-identical to the
// bytes we'll sign — the RPC substitutes a fresh blockhash internally via
// `replaceRecentBlockhash`, so the sim reflects current chain state.
// If sim fails, we show a clean error in the UI and never trigger Phantom.
// =====================================================================
const JUPITER_ERROR_CODES = {
  6000: 'No swap route available',
  6001: 'Price moved — try increasing slippage tolerance',
  6002: 'Routing calculation error — try again',
  6003: 'Fee account misconfigured',
  6004: 'Invalid slippage value',
  6005: 'Insufficient liquidity along route',
  6006: 'Invalid input mint',
  6007: 'Invalid output mint',
  6008: 'Account setup error',
  6009: 'Order constraint not supported',
  6010: 'Invalid route plan',
  6011: 'Invalid referral authority',
  6012: 'Token ledger mismatch',
  6013: 'Invalid token ledger',
  6014: 'Token program incompatibility — this stock may need different routing',
};

function parseSimError(err, logs) {
  if (!err) return 'Transaction would fail';
  if (typeof err === 'string') return err;
  if (err?.InstructionError) {
    const [idx, detail] = err.InstructionError;
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const code = Number(detail.Custom);
      const known = JUPITER_ERROR_CODES[code];
      if (known) return known;
      return `Program error 0x${code.toString(16)} at instruction ${idx}`;
    }
    if (typeof detail === 'string') return `${detail} at instruction ${idx}`;
  }
  // Last resort: scan logs
  const arr = Array.isArray(logs) ? logs : [];
  const errLog = arr.find(l => /error|failed|insufficient|slippage/i.test(String(l)));
  if (errLog) return String(errLog).slice(0, 140);
  return 'Trade unavailable — try a different amount or stock';
}

async function simulateBeforeSign(serializedTxBase64) {
  try {
    const res = await fetchWithTimeout('/api/solana-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'simulateTransaction',
        params: [serializedTxBase64, {
          encoding:               'base64',
          commitment:             'processed',
          replaceRecentBlockhash: true,
          sigVerify:              false,
        }],
      }),
    }, 12_000);
    const json = await res.json();
    if (json?.error) return { ok: false, message: json.error.message || 'Simulation RPC error' };
    const value = json?.result?.value;
    if (!value)     return { ok: true,  warning: 'No sim result' };
    if (value.err)  return { ok: false, message: parseSimError(value.err, value.logs) };
    return { ok: true };
  } catch (e) {
    // If our sim endpoint is down, don't block the user — Phantom's own sim
    // is the ultimate safety net. We fail open with a warning.
    console.warn('[sim]', e?.message || e);
    return { ok: true, warning: 'Pre-sim unavailable' };
  }
}

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function StockBadge({ stock, size = 40 }) {
  const letter = (stock.ticker || stock.symbol || '?').charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${stock.color},${stock.color}dd)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 900, fontSize: Math.round(size * 0.38),
      flexShrink: 0, letterSpacing: '-.02em', textShadow: '0 1px 3px rgba(0,0,0,.5)',
      boxShadow: `0 4px 14px ${stock.color}50`,
      ...T.display,
    }}>{letter}</div>
  );
}

function StockTile({ stock, price, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '14px 16px', borderBottom: `1px solid ${C.hairline}`,
      display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center',
      background: 'transparent', border: 'none', borderBottom: `1px solid ${C.hairline}`,
      borderLeft: 'none', borderRight: 'none', borderTop: 'none',
      width: '100%', textAlign: 'left', cursor: 'pointer',
      WebkitTapHighlightColor: 'rgba(151,252,228,.10)', transition: 'background .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(151,252,228,.03)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <StockBadge stock={stock} size={40}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 14, letterSpacing: '-.01em', ...T.display }}>{stock.symbol}</span>
          <span style={{ color: C.muted2, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.04)', letterSpacing: '.04em', ...T.mono }}>{stock.ticker}</span>
        </div>
        <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2, ...T.body }}>{stock.name}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: price > 0 ? C.inkStr : C.muted, fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {price > 0 ? fmtUsd(price) : '—'}
        </div>
        <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', marginTop: 2, ...T.mono }}>TAP TO TRADE</div>
      </div>
    </button>
  );
}

// =====================================================================
// TradeModal — buy or sell flow with Jupiter quote + signed swap
// =====================================================================
function TradeModal({ open, stock, price, onClose, walletPubkey, onConnectWallet }) {
  const { signTransaction, connected } = useWallet();
  const { activeWalletKind } = useNexusWallet();
  const wcon = connected || activeWalletKind === 'privy';

  const [side, setSide]       = useState('BUY'); // BUY | SELL
  const [amount, setAmount]   = useState('');
  const [quote, setQuote]     = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]     = useState('');
  const quoteSeq = useRef(0);

  useBodyLock(open);

  useEffect(() => {
    if (!open) {
      setAmount(''); setQuote(null); setError(''); setSubmitState({ kind: 'idle', message: '' });
      setSide('BUY');
    }
  }, [open]);

  // Debounced quote fetch
  useEffect(() => {
    if (!open || !stock) return;
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }

    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const isBuy = side === 'BUY';
        const inputMint  = isBuy ? USDC_MINT : stock.mint;
        const outputMint = isBuy ? stock.mint : USDC_MINT;
        const decimals   = isBuy ? USDC_DECIMALS : stock.decimals;
        const atomic     = Math.round(n * 10 ** decimals);
        if (atomic < 1) { setQuote(null); setQuoting(false); return; }
        const q = await getJupiterQuote({ inputMint, outputMint, amountAtomic: atomic, slippageBps: SLIPPAGE_BPS_MAX });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setError(e.message || 'Quote failed');
        setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [amount, side, stock, open]);

  if (!open || !stock) return null;

  const usd       = parseFloat(amount) || 0;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';

  const outAtomic   = quote ? Number(quote.outAmount) : 0;
  const isBuy       = side === 'BUY';
  const outDecimals = isBuy ? stock.decimals : USDC_DECIMALS;
  const outAmount   = outAtomic / 10 ** outDecimals;

  const platformFeeAtomic = quote?.platformFee?.amount ? Number(quote.platformFee.amount) : 0;
  const platformFeeUsd    = isBuy
    ? platformFeeAtomic / 10 ** USDC_DECIMALS
    : platformFeeAtomic / 10 ** USDC_DECIMALS; // both sides take fee in USDC
  const priceImpactPct = quote?.priceImpactPct ? Number(quote.priceImpactPct) * 100 : 0;

  const validStake = isBuy ? (usd >= MIN_USDC && usd <= MAX_USDC) : usd > 0;

  const handleSubmit = async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (!walletPubkey || !isValidSolAddr(walletPubkey)) { setError('Wallet not connected'); return; }
    if (!TREASURY_USDC_ATA) { setError('Trading not configured — REACT_APP_TREASURY_USDC_ATA missing'); return; }
    if (!quote) { setError('No quote available'); return; }
    if (!signTransaction) { setError('Wallet cannot sign'); return; }

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });
    setError('');

    try {
      const built = await getJupiterSwap({ quoteResponse: quote, userPublicKey: walletPubkey, feeAccount: TREASURY_USDC_ATA });
      if (!built?.swapTransaction) throw new Error('Build returned no transaction');

      // ── Pre-wallet simulation ────────────────────────────────────────
      // Run the EXACT serialized bytes through Solana RPC simulateTransaction
      // before triggering Phantom. RPC substitutes a fresh blockhash so the
      // sim reflects current chain state; we sign the SAME bytes after.
      // If sim fails, we surface a clean error and never trigger the wallet.
      setSubmitState({ kind: 'loading', message: 'Simulating...' });
      const sim = await simulateBeforeSign(built.swapTransaction);
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      setSubmitState({ kind: 'loading', message: 'Confirm in your wallet...' });
      const txBytes = Uint8Array.from(atob(built.swapTransaction), c => c.charCodeAt(0));
      let tx;
      try { tx = VersionedTransaction.deserialize(txBytes); }
      catch { tx = Transaction.from(txBytes); }

      const signed = await signTransaction(tx);

      setSubmitState({ kind: 'loading', message: 'Submitting on Solana...' });
      // We already pre-simulated successfully, so skipPreflight is safe and
      // saves a round-trip. Higher maxRetries helps the tx land during
      // congestion (paired with the high priority fee in the swap build).
      const serialized = btoa(String.fromCharCode(...signed.serialize()));
      const submitRes = await fetchWithTimeout('/api/solana-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'sendTransaction',
          params: [serialized, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 5 }],
        }),
      }, 20_000);
      const submitJson = await submitRes.json();
      if (submitJson.error) throw new Error(submitJson.error.message || 'Submit failed');

      setSubmitState({ kind: 'success', message: 'Swap submitted' });
      setTimeout(() => { onClose(); setSubmitState({ kind: 'idle', message: '' }); }, 2200);
    } catch (e) {
      console.error('[stocks swap]', e);
      const msg = e.message || 'Swap failed';
      setSubmitState({ kind: 'error', message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4500);
    }
  };

  const quickChips = isBuy ? [50, 100, 500, 1000] : [0.1, 1, 5, 10];

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(14px)', cursor: isBusy ? 'wait' : 'pointer' }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 540, zIndex: 401,
        background: `linear-gradient(180deg,${C.surface2} 0%,${C.bg} 100%)`,
        borderTop: `1px solid ${C.borderHi}`, borderRadius: '26px 26px 0 0',
        maxHeight: '92dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: `0 -28px 80px rgba(0,0,0,.7), ${C.glow}`,
      }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '14px 22px 12px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.12)', borderRadius: 99, margin: '0 auto 16px' }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StockBadge stock={stock} size={44}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: C.inkStr, letterSpacing: '-.02em', ...T.display }}>{stock.symbol}</span>
                <span style={{ color: C.muted2, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(255,255,255,.04)', letterSpacing: '.04em', ...T.mono }}>{stock.ticker}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1, ...T.body }}>{stock.name}</div>
            </div>
            <button onClick={isBusy ? undefined : onClose} disabled={isBusy} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, color: C.muted, width: 32, height: 32, borderRadius: 10, fontSize: 18, cursor: isBusy ? 'not-allowed' : 'pointer', flexShrink: 0 }}>×</button>
          </div>
          {price > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>LIVE PRICE</span>
              <span style={{ fontSize: 16, color: C.inkStr, fontWeight: 800, fontVariantNumeric: 'tabular-nums', ...T.mono }}>{fmtUsd(price)}</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 14px', minHeight: 0 }}>
          {/* Side toggle */}
          <div style={{ display: 'inline-flex', padding: 3, marginBottom: 14, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 999, gap: 3, width: '100%' }}>
            {['BUY', 'SELL'].map(s => {
              const active = side === s;
              const c = s === 'BUY' ? C.up : C.down;
              return (
                <button key={s} onClick={() => { if (!isBusy) { setSide(s); setAmount(''); setQuote(null); } }} disabled={isBusy} style={{
                  flex: 1, padding: '9px 16px', borderRadius: 999, border: 'none',
                  background: active ? (s === 'BUY' ? 'rgba(61,213,152,.18)' : 'rgba(255,138,158,.18)') : 'transparent',
                  color: active ? c : C.muted, fontWeight: 800, fontSize: 13,
                  cursor: isBusy ? 'not-allowed' : 'pointer', letterSpacing: '-.01em', ...T.display,
                }}>{s === 'BUY' ? 'Buy with USDC' : 'Sell to USDC'}</button>
              );
            })}
          </div>

          {/* Amount input */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>
                YOU PAY ({isBuy ? 'USDC' : stock.symbol})
              </span>
              <span style={{ fontSize: 9, color: C.hl, fontWeight: 700, background: C.hlDim, border: `1px solid ${C.borderHi}`, padding: '3px 8px', borderRadius: 6, ...T.mono }}>2.55% FEE</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10, opacity: isBusy ? 0.6 : 1 }}>
              <span style={{ color: C.muted, fontSize: 18, ...T.mono }}>{isBuy ? '$' : ''}</span>
              <input value={amount} onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }} placeholder="0.00" disabled={isBusy} inputMode="decimal" enterKeyHint="done"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 800, color: C.inkStr, outline: 'none', fontVariantNumeric: 'tabular-nums', ...T.display }}/>
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{isBuy ? 'USDC' : stock.symbol}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {quickChips.map(c => (
                <button key={c} onClick={() => { setAmount(String(c)); setError(''); }} disabled={isBusy} style={{ flex: 1, padding: 8, borderRadius: 10, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,.03)', color: C.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: isBusy ? 0.4 : 1, ...T.mono }}>{isBuy ? '$' + c : c}</button>
              ))}
            </div>
          </div>

          {/* Quote preview */}
          {usd > 0 && (
            <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...T.mono }}>
                <span>YOU RECEIVE</span>
                {quoting && <span style={{ color: C.hl }}>updating...</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: outAtomic > 0 ? C.inkStr : C.muted, fontVariantNumeric: 'tabular-nums', marginBottom: 10, ...T.display }}>
                {outAtomic > 0 ? (isBuy ? fmtAmt(outAmount, 6) + ' ' + stock.symbol : fmtUsd(outAmount, 2)) : '—'}
              </div>
              {quote && (
                <div style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8 }}>
                  {[
                    ['Platform fee (2.55%)', '-' + fmtUsd(platformFeeUsd || 0, 2)],
                    ['Price impact', (priceImpactPct >= 0 ? '' : '') + priceImpactPct.toFixed(2) + '%'],
                    ['Route', (quote.routePlan?.length || 1) + ' hop' + ((quote.routePlan?.length || 1) === 1 ? '' : 's')],
                  ].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ color: C.muted, fontSize: 11, ...T.body }}>{l}</span>
                      <span style={{ color: C.ink, fontSize: 11, fontWeight: 700, ...T.mono }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer / submit */}
        <div style={{ flexShrink: 0, padding: '12px 22px calc(env(safe-area-inset-bottom) + 90px)', borderTop: `1px solid ${C.hairline}`, background: `linear-gradient(180deg,transparent 0%,${C.bg} 20%)` }}>
          {submitState.kind === 'loading' && submitState.message && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(151,252,228,.05)', border: '1px solid rgba(151,252,228,.20)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.hlDim}`, borderTopColor: C.hl, animation: 'nx-spin 0.8s linear infinite' }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{submitState.message}</span>
            </div>
          )}
          {(error || submitState.kind === 'error') && (
            <div style={{ marginBottom: 10, padding: 10, background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, fontSize: 12, color: C.down, ...T.body }}>
              {error || submitState.message}
            </div>
          )}

          {!wcon ? (
            <button onClick={() => onConnectWallet?.()} style={{ width: '100%', padding: 17, borderRadius: 16, border: 'none', background: `linear-gradient(135deg,${C.violet} 0%,${C.hl2} 100%)`, color: '#04070f', fontWeight: 800, fontSize: 16, cursor: 'pointer', minHeight: 56, letterSpacing: '-.01em', ...T.display }}>
              Connect Wallet
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={isBusy || !quote || !validStake} style={{
              width: '100%', padding: 17, borderRadius: 16, border: 'none',
              background: isSuccess
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : side === 'BUY'
                ? `linear-gradient(135deg,${C.up} 0%,${C.hl2} 100%)`
                : `linear-gradient(135deg,${C.down} 0%,${C.violet} 100%)`,
              color: '#04070f', fontWeight: 800, fontSize: 16,
              cursor: isBusy || !quote || !validStake ? 'not-allowed' : 'pointer',
              minHeight: 56, opacity: !quote || !validStake ? 0.55 : 1,
              boxShadow: '0 12px 30px rgba(151,252,228,.18)',
              letterSpacing: '-.01em', ...T.display,
            }}>
              {isBusy ? 'Processing...' :
               isSuccess ? 'Swap placed' :
               !validStake ? `Enter ${isBuy ? 'USDC' : stock.symbol} amount` :
               !quote ? (quoting ? 'Getting quote...' : 'No quote') :
               `${side === 'BUY' ? 'Buy' : 'Sell'} ${stock.symbol} · ${fmtUsd(usd, 2)}`}
            </button>
          )}

          <div style={{ fontSize: 9.5, color: C.muted2, textAlign: 'center', marginTop: 10, lineHeight: 1.5, ...T.body }}>
            Trade tokenized equity via Jupiter · USDC settles to your Solana wallet · No KYC
          </div>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN
// =====================================================================
export default function Stocks({ onConnectWallet }) {
  const [filter, setFilter]   = useState('All');
  const [prices, setPrices]   = useState({});
  const [active, setActive]   = useState(null); // active stock for modal
  const [marketStatus, setMarketStatus] = useState(() => getUsMarketStatus());

  const { publicKey: solPk } = useWallet();
  const { privyEmbeddedSol } = useNexusWallet();
  const walletPubkey = useMemo(() => {
    if (solPk) return solPk.toString();
    if (privyEmbeddedSol?.address) return privyEmbeddedSol.address;
    return null;
  }, [solPk, privyEmbeddedSol]);

  // Poll prices every 30s
  useEffect(() => {
    let alive = true;
    const mints = STOCKS.map(s => s.mint);
    const tick = async () => {
      const result = await fetchStockPrices(mints);
      if (!alive) return;
      setPrices(result);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Update market status every minute
  useEffect(() => {
    const id = setInterval(() => setMarketStatus(getUsMarketStatus()), 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'All')      return STOCKS;
    if (filter === 'Trending') return STOCKS.filter(s => ['TSLA','NVDA','SPY','MSTR','AAPL','COIN','CRCL'].includes(s.ticker));
    return STOCKS.filter(s => s.sector === filter);
  }, [filter]);

  const totalListed = STOCKS.length;
  const totalPriced = Object.keys(prices).length;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nx-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes nx-spin { to{transform:rotate(360deg)} } body.nexus-scroll-locked { overflow:hidden; }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 10, marginBottom: 18, padding: '22px 20px 20px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(168,127,255,.16),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', left: -60, bottom: -80, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.10),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketStatus.open ? C.up : C.muted2, boxShadow: marketStatus.open ? `0 0 8px ${C.up}` : 'none', animation: marketStatus.open ? 'nx-pulse 1.6s ease-in-out infinite' : 'none' }}/>
                <span style={{ color: marketStatus.open ? C.up : C.muted, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>{marketStatus.label.toUpperCase()}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: 'rgba(255,205,60,.08)', border: '1px solid rgba(255,205,60,.20)' }}>
                <span style={{ color: C.gold, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>24/7 TRADING</span>
              </div>
            </div>
            <h1 style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.04em', ...T.hero }}>
              Trade global{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>stocks</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 16px', fontWeight: 500, lineHeight: 1.5, ...T.body }}>
              Tokenized equities settle in USDC on Solana. No broker, no KYC, no market hours.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '12px 14px', borderRadius: 14, background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}` }}>
              {[
                { label: 'STOCKS', value: String(totalListed),                color: C.inkStr },
                { label: 'PRICED', value: String(totalPriced),                color: totalPriced > 0 ? C.hl : C.muted },
                { label: 'FEE',    value: (PLATFORM_FEE_BPS / 100).toFixed(2) + '%', color: C.gold },
              ].map((s, i) => (
                <div key={s.label} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FILTERS */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: '7px 13px', borderRadius: 999,
              border: `1px solid ${filter === f.id ? C.borderHi : C.border}`,
              background: filter === f.id ? C.hlDim : 'rgba(255,255,255,.03)',
              color: filter === f.id ? C.hl : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, ...T.body,
            }}>{f.label}</button>
          ))}
        </div>

        {/* CONFIG WARNING (only shows if treasury ATA not set) */}
        {!TREASURY_USDC_ATA && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(245,181,61,.08)', border: '1px solid rgba(245,181,61,.30)', fontSize: 11, color: C.amber, fontWeight: 600, lineHeight: 1.4, ...T.body }}>
            ⚠️ Trading disabled — set <code style={{ ...T.mono, fontSize: 10 }}>REACT_APP_TREASURY_USDC_ATA</code> before going live.
          </div>
        )}

        {/* STOCK LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 18, backdropFilter: 'blur(12px)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '30px 16px', textAlign: 'center', color: C.muted, fontSize: 12, ...T.body }}>
              No stocks in this category.
            </div>
          ) : filtered.map(s => (
            <StockTile key={s.mint} stock={s} price={prices[s.mint] || 0} onClick={() => setActive(s)}/>
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>JUPITER · xSTOCKS</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
        <div style={{ fontSize: 9.5, color: C.muted2, lineHeight: 1.5, textAlign: 'center', padding: '4px 8px 0', ...T.body }}>
          xStocks issued by Backed Finance (Swiss-regulated). Each token backed 1:1 by underlying equity in qualified custody. 2.55% builder fee per swap. Settles in USDC on Solana.
        </div>
      </div>

      <TradeModal
        open={!!active}
        stock={active}
        price={active ? prices[active.mint] || 0 : 0}
        onClose={() => setActive(null)}
        walletPubkey={walletPubkey}
        onConnectWallet={onConnectWallet}
      />
    </>
  );
}
