import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from '@solana/web3.js';

// =====================================================================
// ANIME-FUTURIST PALETTE
// Deep violet base · electric cyan · neon magenta · BTC orange as accent
// =====================================================================
const STBTC_CSS = `
.ax-page,.ax-modal-backdrop,.ax-sheet {
  --ax-bg:#07041a; --ax-bg-2:#0d0729;
  --ax-surface:#140a35; --ax-surface-2:#1c1247;
  --ax-ink:#f0e7ff; --ax-ink-str:#ffffff;
  --ax-muted:#a78bfa; --ax-muted-2:#6d5d9c;
  --ax-cyan:#22d3ee; --ax-cyan-2:#67e8f9;
  --ax-pink:#f472b6; --ax-pink-2:#ec4899;
  --ax-violet:#a78bfa; --ax-violet-2:#c4b5fd;
  --ax-btc:#f7931a;
  --ax-border:rgba(167,139,250,.18);
  --ax-border-hi:rgba(34,211,238,.42);
  --ax-border-pink:rgba(244,114,182,.38);
  --ax-hairline:rgba(255,255,255,.06);
  --ax-up:#4ade80; --ax-down:#fb7185;
  --ax-font-display:'Syne','Unbounded',system-ui,sans-serif;
  --ax-font-body:'Syne','DM Sans',system-ui,sans-serif;
  --ax-font-mono:'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace;
  font-family:var(--ax-font-body);color:var(--ax-ink);
}
.ax-page,.ax-page *,.ax-sheet,.ax-sheet *{box-sizing:border-box}
body.nexus-scroll-locked{overflow:hidden}
@keyframes ax-pulse{50%{opacity:.4}}
@keyframes ax-spin{to{transform:rotate(360deg)}}
@keyframes ax-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes ax-shimmer{0%{left:-110px}50%,100%{left:130%}}
@keyframes ax-orb-pulse{0%,100%{transform:scale(1);filter:hue-rotate(0deg)}50%{transform:scale(1.05);filter:hue-rotate(20deg)}}
@keyframes ax-scan{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes ax-glow{0%,100%{box-shadow:0 0 24px rgba(34,211,238,.35),0 0 48px rgba(244,114,182,.18)}50%{box-shadow:0 0 32px rgba(34,211,238,.55),0 0 64px rgba(244,114,182,.28)}}

.ax-page{max-width:520px;margin:0 auto;width:100%;padding:0 16px calc(env(safe-area-inset-bottom) + 90px);position:relative}

/* HERO */
.ax-mini-hero{margin-top:14px;padding:18px 18px 16px;border-radius:18px;
  background:
    radial-gradient(ellipse at 0% 0%,rgba(34,211,238,.10),transparent 55%),
    radial-gradient(ellipse at 100% 100%,rgba(244,114,182,.10),transparent 55%),
    linear-gradient(135deg,#07041a,#140a35);
  border:1px solid var(--ax-border-hi);position:relative;overflow:hidden;
  animation:ax-glow 4s ease-in-out infinite}
.ax-mini-hero::before{content:'';position:absolute;inset:-1px;border-radius:18px;padding:1px;
  background:linear-gradient(135deg,var(--ax-cyan),var(--ax-pink) 50%,var(--ax-violet));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;opacity:.6;pointer-events:none}
.ax-mini-hero::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,transparent,var(--ax-cyan),transparent);
  animation:ax-scan 5s linear infinite;pointer-events:none;opacity:.4}
.ax-mh-row{display:flex;justify-content:space-between;align-items:center;gap:14px;position:relative;z-index:2}
.ax-mh-left{flex:1;min-width:0}
.ax-mh-eyebrow{display:inline-block;font-family:var(--ax-font-mono);font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  background:linear-gradient(90deg,var(--ax-cyan),var(--ax-pink));
  -webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:8px}
.ax-mh-title{font-family:var(--ax-font-display);font-weight:900;font-size:clamp(22px,6.5vw,28px);line-height:1;letter-spacing:-.03em;margin:0 0 6px;color:var(--ax-ink-str)}
.ax-mh-title .grad{background:linear-gradient(90deg,var(--ax-cyan),var(--ax-pink) 60%,var(--ax-violet));
  -webkit-background-clip:text;background-clip:text;color:transparent;font-style:italic;font-weight:500}
.ax-mh-sub{font-family:var(--ax-font-body);font-size:12px;font-weight:600;color:var(--ax-violet-2);line-height:1.4;margin:0}
.ax-orb{flex-shrink:0;width:64px;height:64px;border-radius:50%;position:relative;
  background:
    radial-gradient(circle at 35% 30%,#ffb84d,#f7931a 45%,#7a3a00 90%);
  box-shadow:
    0 0 24px rgba(247,147,26,.45),
    0 0 48px rgba(244,114,182,.25),
    inset 0 -4px 12px rgba(0,0,0,.4),
    inset 0 2px 6px rgba(255,200,120,.5);
  display:grid;place-items:center;font-family:var(--ax-font-display);font-weight:900;font-size:32px;color:#fff;
  text-shadow:0 1px 2px rgba(0,0,0,.5);animation:ax-orb-pulse 3.2s ease-in-out infinite}

/* KYC pill */
.ax-kyc{margin:12px 0 6px;display:flex;align-items:center;justify-content:center;gap:14px;
  padding:9px 14px;border-radius:100px;
  background:linear-gradient(90deg,rgba(0,0,0,.5),rgba(34,211,238,.08),rgba(244,114,182,.08),rgba(0,0,0,.5));
  border:1px solid var(--ax-border)}
.ax-kyc span{font-family:var(--ax-font-mono);font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ax-cyan-2);white-space:nowrap}
.ax-kyc .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--ax-pink);opacity:.7}

/* Price strip */
.ax-price-strip{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-radius:14px;
  background:linear-gradient(135deg,rgba(20,10,53,.9),rgba(28,18,71,.9));
  border:1px solid var(--ax-border-hi);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.ax-ps-left{display:flex;align-items:center;gap:10px}
.ax-ps-label{font-family:var(--ax-font-mono);font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ax-violet)}
.ax-ps-pulse{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--ax-up);box-shadow:0 0 8px var(--ax-up);animation:ax-pulse 1.4s infinite}
.ax-ps-val{font-family:var(--ax-font-mono);font-weight:800;color:var(--ax-ink-str);font-size:15px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.ax-ps-net{font-family:var(--ax-font-mono);font-size:9px;color:var(--ax-cyan);font-weight:800;letter-spacing:.08em;
  text-shadow:0 0 8px rgba(34,211,238,.5)}

/* WIDGET */
.ax-widget-title{display:flex;align-items:center;justify-content:space-between;padding:20px 4px 10px}
.ax-widget-title .nm{font-family:var(--ax-font-display);font-weight:800;font-size:20px;color:var(--ax-ink-str);letter-spacing:-.01em}
.ax-widget-title .nm .arrow{background:linear-gradient(90deg,var(--ax-cyan),var(--ax-pink));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.ax-widget-title .live{display:flex;align-items:center;gap:6px;font-family:var(--ax-font-mono);font-size:10px;font-weight:800;color:var(--ax-cyan);border:1px solid var(--ax-border-hi);border-radius:100px;padding:5px 11px;
  background:rgba(34,211,238,.10);text-shadow:0 0 6px rgba(34,211,238,.4)}
.ax-widget-title .live .d{width:5px;height:5px;border-radius:50%;background:var(--ax-cyan);box-shadow:0 0 8px var(--ax-cyan);animation:ax-pulse 1.6s ease-in-out infinite}

.ax-card{position:relative;
  background:linear-gradient(180deg,var(--ax-surface) 0%,var(--ax-bg-2) 100%);
  border:1.5px solid var(--ax-border);border-radius:22px;padding:18px;backdrop-filter:blur(10px)}
.ax-card::before{content:'';position:absolute;inset:-1px;border-radius:22px;padding:1.5px;
  background:linear-gradient(135deg,rgba(34,211,238,.4),transparent 40%,transparent 60%,rgba(244,114,182,.4));
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.6}

.ax-row{position:relative;background:rgba(167,139,250,.04);border:1.5px solid var(--ax-border);border-radius:14px;padding:14px;margin-bottom:8px;transition:border-color .15s,box-shadow .15s}
.ax-row:focus-within{border-color:var(--ax-cyan);box-shadow:0 0 0 3px rgba(34,211,238,.12)}
.ax-row-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ax-row-label{font-family:var(--ax-font-mono);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ax-violet)}
.ax-row-bal{font-family:var(--ax-font-mono);font-size:10px;color:var(--ax-muted);font-weight:700}
.ax-row-bal b{color:var(--ax-cyan-2);font-weight:800}
.ax-row-mid{display:flex;align-items:center;gap:10px}
.ax-tok-btn{flex-shrink:0;display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:10px;
  background:rgba(167,139,250,.10);border:1px solid rgba(167,139,250,.40);
  color:var(--ax-ink-str);font-family:var(--ax-font-display);font-weight:800;font-size:13px;cursor:default}
.ax-tok-btn.btc{background:rgba(247,147,26,.10);border-color:rgba(247,147,26,.45)}
.ax-tok-dot-sol{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#9945ff,#14f195);
  box-shadow:inset 0 -2px 6px rgba(0,0,0,.3),0 0 8px rgba(153,69,255,.4)}
.ax-tok-dot-btc{width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffb84d,#f7931a 50%,#cc6e00);
  box-shadow:inset 0 -2px 6px rgba(0,0,0,.3),0 0 8px rgba(247,147,26,.4)}
.ax-amt{flex:1;background:transparent;border:none;outline:none;color:var(--ax-ink-str);font-family:var(--ax-font-display);font-weight:900;font-size:24px;text-align:right;letter-spacing:-.02em;font-variant-numeric:tabular-nums;min-width:0;width:100%}
.ax-amt::placeholder{color:var(--ax-muted-2);font-weight:700}
.ax-amt.out{cursor:default}
.ax-usd-line{font-family:var(--ax-font-mono);font-size:10px;color:var(--ax-muted);text-align:right;margin-top:6px;font-weight:600}

.ax-addr-wrap{margin-bottom:10px}
.ax-addr-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-family:var(--ax-font-mono);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ax-violet)}
.ax-addr-input{width:100%;padding:13px 14px;border-radius:12px;background:rgba(167,139,250,.04);border:1.5px solid var(--ax-border);color:var(--ax-ink-str);font-family:var(--ax-font-mono);font-size:12px;font-weight:600;outline:none;transition:border-color .15s,box-shadow .15s}
.ax-addr-input::placeholder{color:var(--ax-muted-2)}
.ax-addr-input:focus{border-color:var(--ax-cyan);box-shadow:0 0 0 3px rgba(34,211,238,.12)}
.ax-addr-input.invalid{border-color:var(--ax-down)}
.ax-addr-hint{font-family:var(--ax-font-mono);font-size:9px;color:var(--ax-muted-2);font-weight:700;margin-top:4px;letter-spacing:.06em}
.ax-addr-hint.err{color:var(--ax-down)}

.ax-route{background:linear-gradient(135deg,rgba(34,211,238,.05),rgba(244,114,182,.05));border:1px solid rgba(34,211,238,.22);border-radius:12px;padding:12px;margin-bottom:14px}
.ax-route-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-family:var(--ax-font-mono);font-size:11px}
.ax-route-row .k{color:var(--ax-muted);font-weight:700}
.ax-route-row .v{color:var(--ax-ink-str);font-weight:800;font-variant-numeric:tabular-nums}
.ax-route-row .v.cyan{color:var(--ax-cyan)}
.ax-route-row .v.btc{color:var(--ax-btc);text-shadow:0 0 6px rgba(247,147,26,.35)}

.ax-cta{width:100%;padding:18px;border-radius:14px;border:none;color:#07041a;
  font-family:var(--ax-font-display);font-weight:900;font-size:14px;cursor:pointer;letter-spacing:.04em;
  background:linear-gradient(135deg,var(--ax-cyan),var(--ax-pink) 80%,var(--ax-violet));
  box-shadow:
    0 8px 28px rgba(34,211,238,.30),
    0 4px 24px rgba(244,114,182,.25),
    0 4px 0 rgba(0,0,0,.2),
    inset 0 -3px 0 rgba(0,0,0,.12),
    inset 0 2px 0 rgba(255,255,255,.35);
  position:relative;overflow:hidden;transition:all .15s cubic-bezier(0.2,1.2,0.4,1)}
.ax-cta::after{content:'';position:absolute;top:0;bottom:0;width:70px;left:-110px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);animation:ax-shimmer 2.8s ease-in-out infinite}
.ax-cta:active:not(:disabled){transform:translateY(3px)}
.ax-cta:disabled{cursor:not-allowed;opacity:0.5}
.ax-cta:disabled::after{display:none}
.ax-cta.connect{background:linear-gradient(135deg,#a78bfa,#22d3ee);color:#07041a}
.ax-cta-footer{font-family:var(--ax-font-mono);font-size:10px;color:var(--ax-muted-2);text-align:center;margin-top:10px;font-weight:600;line-height:1.5}

.ax-banner{margin-bottom:10px;padding:11px 12px;border-radius:12px;display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600}
.ax-banner.info{background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.28);color:var(--ax-cyan-2)}
.ax-banner.err{background:rgba(251,113,133,.08);border:1px solid rgba(251,113,133,.28);color:var(--ax-down)}
.ax-banner.ok{background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.28);color:var(--ax-up)}
.ax-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(34,211,238,.16);border-top-color:var(--ax-cyan);animation:ax-spin 0.8s linear infinite;flex-shrink:0}

.ax-powered{display:flex;align-items:center;justify-content:center;gap:9px;padding:12px 16px;border-radius:14px;background:rgba(167,139,250,.04);border:1px solid var(--ax-border);margin-top:14px}
.ax-powered-label{font-family:var(--ax-font-mono);font-size:9px;color:var(--ax-muted-2);font-weight:700;letter-spacing:.08em}
.ax-powered-name{font-family:var(--ax-font-mono);font-size:11px;font-weight:800;letter-spacing:.04em;
  background:linear-gradient(90deg,var(--ax-cyan),var(--ax-pink));
  -webkit-background-clip:text;background-clip:text;color:transparent}
.ax-powered-sep{color:var(--ax-muted-2);font-size:9px}
`;

// =====================================================================
// CONFIG
// =====================================================================
const FEE_WALLET   = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const SOL_FEE_BPS  = 500;                  // 5% — collected on-chain by us
const MIN_SOL      = 0.05;
const MAX_SOL      = 50;

const THORNODE       = 'https://thornode.ninerealms.com';
const SOL_NATIVE     = new PublicKey('11111111111111111111111111111111');
const MEMO_PROGRAM   = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const LAMPORTS_PER_SOL = 1_000_000_000;
const THOR_DECIMALS  = 8;
const SATS_PER_BTC   = 1e8;

// =====================================================================
// UTILS
// =====================================================================
function fmtUsd(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)    return '$' + n.toFixed(d);
  return '$' + n.toFixed(4);
}
function fmtBtc(n, d = 8) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  return Number(n).toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
}
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function isValidBtcAddr(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const s = addr.trim();
  if (/^bc1[a-z0-9]{6,87}$/i.test(s)) return true;
  if (/^bc1p[a-z0-9]{6,87}$/i.test(s)) return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(s)) return true;
  return false;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 14_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

async function fetchJupPrice(mint, timeoutMs = 6_000) {
  try {
    const url = `https://lite-api.jup.ag/price/v3?ids=${mint}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
    if (!res.ok) return 0;
    const json = await res.json();
    const entry = Object.values(json || {})[0];
    const p = Number(entry?.usdPrice);
    return Number.isFinite(p) && p > 0 ? p : 0;
  } catch { return 0; }
}
const fetchBtcPrice = () => fetchJupPrice('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const fetchSolPrice = () => fetchJupPrice('So11111111111111111111111111111111111111112');

// ---- ThorChain quote --------------------------------------------------
// SOL uses 9 decimals; ThorChain normalizes all amounts to 8 decimals (1e8).
// 1 lamport (1e-9 SOL) = 0.1 thor-units, so convert with /10.
function lamportsToThorUnits(lamportsBig) {
  return BigInt(lamportsBig) / 10n;
}

async function getThorQuote({ swapLamports, btcAddress }) {
  const fromAmount = lamportsToThorUnits(swapLamports).toString();
  const params = new URLSearchParams({
    from_asset:  'SOL.SOL',
    to_asset:    'BTC.BTC',
    amount:      fromAmount,
    destination: btcAddress,
  });
  const url = `${THORNODE}/thorchain/quote/swap?${params}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 14_000);
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error || json?.message || `ThorChain quote failed (${res.status})`;
    throw new Error(msg);
  }
  // Expected fields: inbound_address, memo, expected_amount_out (1e8 sats-equivalent),
  // recommended_min_amount_in, slippage_bps, dust_threshold, outbound_delay_seconds, expiry, fees.
  if (!json.inbound_address) throw new Error('No active Solana vault — try again');
  if (!json.memo) throw new Error('Quote missing memo');
  return json;
}

// ---- Instruction builders --------------------------------------------
function memoInstruction(memo, signerPubkey) {
  return new TransactionInstruction({
    keys: [{ pubkey: signerPubkey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM,
    data: new TextEncoder().encode(memo),
  });
}

async function getRecentBlockhash() {
  const res = await fetchWithTimeout('/api/solana-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    }),
  }, 8_000);
  const json = await res.json();
  const bh = json?.result?.value?.blockhash;
  if (!bh) throw new Error('Could not fetch recent blockhash');
  return bh;
}

// =====================================================================
// hooks
// =====================================================================
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

function useStbtcCSS() {
  useEffect(() => {
    const id = 'nexus-stbtc-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = STBTC_CSS;
    document.head.appendChild(el);
  }, []);
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================
export default function SolToBtc({ onConnectWallet }) {
  useStbtcCSS();

  const { publicKey, connected, sendTransaction } = useWallet();
  const walletPubkey = useMemo(() => publicKey ? publicKey.toString() : null, [publicKey]);

  const [solAmount, setSolAmount] = useState('');
  const [btcAddr,   setBtcAddr]   = useState('');
  const [btcAddrTouched, setBtcAddrTouched] = useState(false);
  const [quote,     setQuote]     = useState(null);
  const [quoting,   setQuoting]   = useState(false);
  const [error,     setError]     = useState('');
  const [submit,    setSubmit]    = useState({ kind: 'idle', message: '' });
  const [btcPrice,  setBtcPrice]  = useState(0);
  const [solPrice,  setSolPrice]  = useState(0);

  const quoteSeq = useRef(0);

  // ---- Prices
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [b, s] = await Promise.all([fetchBtcPrice(), fetchSolPrice()]);
      if (!alive) return;
      if (b > 0) setBtcPrice(b);
      if (s > 0) setSolPrice(s);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ---- Quote (debounced)
  useEffect(() => {
    const n = parseFloat(solAmount);
    if (!Number.isFinite(n) || n <= 0 || !btcAddr || !isValidBtcAddr(btcAddr) || !walletPubkey) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true); setError('');
    const t = setTimeout(async () => {
      try {
        const grossLamports = BigInt(Math.round(n * LAMPORTS_PER_SOL));
        const feeLamports   = (grossLamports * BigInt(SOL_FEE_BPS)) / 10000n;
        const swapLamports  = grossLamports - feeLamports;
        if (swapLamports <= 0n) throw new Error('Amount too small');

        const q = await getThorQuote({ swapLamports, btcAddress: btcAddr });
        if (seq !== quoteSeq.current) return;

        setQuote({
          thor: q,
          grossLamports,
          feeLamports,
          swapLamports,
          fetchedAt: Date.now(),
        });
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setError(e.message || 'Quote failed');
        setQuote(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [solAmount, btcAddr, walletPubkey]);

  const isBusy    = submit.kind === 'loading';
  const isSuccess = submit.kind === 'success';

  const n = parseFloat(solAmount) || 0;
  const stakeValid = n >= MIN_SOL && n <= MAX_SOL;
  const addrValid  = isValidBtcAddr(btcAddr);
  const usdEquiv   = solPrice > 0 ? n * solPrice : 0;

  // ThorChain returns expected_amount_out in 1e8 (BTC base units = sats).
  const expectedSats = quote?.thor?.expected_amount_out
    ? Number(quote.thor.expected_amount_out)
    : 0;
  const expectedBtc    = expectedSats / SATS_PER_BTC;
  const expectedBtcUsd = expectedBtc * btcPrice;
  const platformFeeSol = quote ? Number(quote.feeLamports) / LAMPORTS_PER_SOL : 0;
  const platformFeeUsd = platformFeeSol * solPrice;

  const handleSubmit = async () => {
    if (!connected) { onConnectWallet?.(); return; }
    if (!walletPubkey) { setError('Wallet not connected'); return; }
    if (!sendTransaction) { setError('Wallet cannot sign'); return; }
    if (!quote) { setError('Get a quote first'); return; }

    setError('');
    setSubmit({ kind: 'loading', message: 'Refreshing route...' });

    try {
      // Always re-quote right before signing — vault rotates, never cache.
      const fresh = await getThorQuote({
        swapLamports: quote.swapLamports,
        btcAddress:   btcAddr,
      });

      const vault = new PublicKey(fresh.inbound_address);
      const owner = new PublicKey(walletPubkey);

      // Sanity: vault must be a valid 32-byte pubkey (constructor throws otherwise)
      // and must not equal system program.
      if (vault.equals(SOL_NATIVE)) throw new Error('Bad vault returned');

      setSubmit({ kind: 'loading', message: 'Building atomic transaction...' });

      const blockhash = await getRecentBlockhash();

      // Three instructions, single transaction, single signature:
      //   ix0: fee     → user → FEE_WALLET (our cut)
      //   ix1: bridge  → user → ThorChain Solana Asgard vault
      //   ix2: memo    → SPL Memo Program (ThorChain reads this to route to BTC)
      const ixFee = SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey:   FEE_WALLET,
        lamports:   Number(quote.feeLamports),
      });
      const ixBridge = SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey:   vault,
        lamports:   Number(quote.swapLamports),
      });
      const ixMemo = memoInstruction(fresh.memo, owner);

      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: [ixFee, ixBridge, ixMemo],
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);

      setSubmit({ kind: 'loading', message: 'Confirm in your wallet...' });
      const sig = await sendTransaction(tx, undefined);

      setSubmit({
        kind: 'success',
        message: `Bridge submitted · ${sig.slice(0, 8)}…`,
      });

      setTimeout(() => setSubmit({ kind: 'idle', message: '' }), 6000);
      setSolAmount(''); setBtcAddr(''); setBtcAddrTouched(false); setQuote(null);
    } catch (e) {
      console.error('[sol→btc]', e);
      const msg = e.message || 'Transaction failed';
      setSubmit({
        kind: 'error',
        message: /reject|cancel|user/i.test(msg) ? 'Cancelled' : msg,
      });
      setTimeout(() => setSubmit({ kind: 'idle', message: '' }), 5000);
    }
  };

  return (
    <div className="ax-page">
      {/* HERO */}
      <div className="ax-mini-hero">
        <div className="ax-mh-row">
          <div className="ax-mh-left">
            <div className="ax-mh-eyebrow">⟁ POWERED BY THORCHAIN</div>
            <h1 className="ax-mh-title">
              GET NATIVE<br />
              <span className="grad">Bitcoin.</span>
            </h1>
            <p className="ax-mh-sub">Real BTC. Not wrapped. Not synthetic.</p>
          </div>
          <div className="ax-orb">₿</div>
        </div>
      </div>

      <div className="ax-kyc">
        <span>No KYC</span><span className="dot"></span>
        <span>No Account</span><span className="dot"></span>
        <span>No Limits</span>
      </div>

      {/* LIVE BTC PRICE */}
      <div className="ax-price-strip">
        <div className="ax-ps-left">
          <span className="ax-ps-pulse"></span>
          <span className="ax-ps-label">BTC / USD</span>
        </div>
        <div className="ax-ps-val">{btcPrice > 0 ? fmtUsd(btcPrice, 0) : '—'}</div>
        <div className="ax-ps-net">NATIVE BTC</div>
      </div>

      {/* WIDGET */}
      <div className="ax-widget-title">
        <div className="nm">SOL <span className="arrow">→</span> BTC</div>
        <div className="live"><span className="d"></span>LIVE</div>
      </div>

      <div className="ax-card">
        {/* SOL input */}
        <div className="ax-row">
          <div className="ax-row-top">
            <span className="ax-row-label">YOU SEND</span>
            <span className="ax-row-bal">Min <b>{MIN_SOL}</b> SOL · Max <b>{MAX_SOL}</b> SOL</span>
          </div>
          <div className="ax-row-mid">
            <div className="ax-tok-btn">
              <div className="ax-tok-dot-sol"></div>
              SOL
            </div>
            <input
              className="ax-amt"
              value={solAmount}
              onChange={e => { setSolAmount(cleanAmount(e.target.value)); setError(''); }}
              placeholder="0.00"
              disabled={isBusy}
              inputMode="decimal"
            />
          </div>
          {usdEquiv > 0 && (<div className="ax-usd-line">≈ {fmtUsd(usdEquiv, 2)}</div>)}
        </div>

        {/* BTC output */}
        <div className="ax-row">
          <div className="ax-row-top">
            <span className="ax-row-label">YOU RECEIVE (NATIVE BTC)</span>
            {quoting && <span className="ax-row-bal" style={{ color: 'var(--ax-cyan)' }}>quoting…</span>}
          </div>
          <div className="ax-row-mid">
            <div className="ax-tok-btn btc">
              <div className="ax-tok-dot-btc"></div>
              BTC
            </div>
            <div className="ax-amt out">
              {expectedBtc > 0 ? fmtBtc(expectedBtc, 8) : '0.00'}
            </div>
          </div>
          {expectedBtcUsd > 0 && (<div className="ax-usd-line">≈ {fmtUsd(expectedBtcUsd, 2)}</div>)}
        </div>

        {/* BTC address */}
        <div className="ax-addr-wrap">
          <div className="ax-addr-label">
            <span>YOUR BTC ADDRESS</span>
            <span style={{ color: addrValid ? 'var(--ax-up)' : btcAddrTouched && btcAddr ? 'var(--ax-down)' : 'var(--ax-muted-2)' }}>
              {addrValid ? '✓ VALID' : btcAddrTouched && btcAddr ? '✗ INVALID' : 'BC1… / 1… / 3…'}
            </span>
          </div>
          <input
            className={'ax-addr-input' + (btcAddrTouched && btcAddr && !addrValid ? ' invalid' : '')}
            value={btcAddr}
            onChange={e => setBtcAddr(e.target.value.trim())}
            onBlur={() => setBtcAddrTouched(true)}
            placeholder="bc1q…"
            disabled={isBusy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className={'ax-addr-hint' + (btcAddrTouched && btcAddr && !addrValid ? ' err' : '')}>
            {btcAddrTouched && btcAddr && !addrValid
              ? 'Address format not recognized'
              : 'Native Bitcoin only · No Lightning · No Wrapped'}
          </div>
        </div>

        {/* Route summary */}
        {quote && (
          <div className="ax-route">
            <div className="ax-route-row"><span className="k">You send</span><span className="v">{n.toFixed(4)} SOL</span></div>
            <div className="ax-route-row"><span className="k">Platform fee</span><span className="v">{platformFeeSol.toFixed(4)} SOL · {fmtUsd(platformFeeUsd, 2)}</span></div>
            <div className="ax-route-row"><span className="k">Route</span><span className="v cyan">ThorChain · Native L1</span></div>
            {quote.thor.outbound_delay_seconds != null && (
              <div className="ax-route-row"><span className="k">Est. delivery</span><span className="v">~{Math.max(1, Math.round(Number(quote.thor.outbound_delay_seconds) / 60))} min</span></div>
            )}
            <div className="ax-route-row"><span className="k">You receive</span><span className="v btc">{fmtBtc(expectedBtc, 8)} BTC</span></div>
          </div>
        )}

        {/* Status / error */}
        {isBusy && submit.message && (
          <div className="ax-banner info"><div className="ax-spinner"></div><span>{submit.message}</span></div>
        )}
        {(error || submit.kind === 'error') && (
          <div className="ax-banner err">{error || submit.message}</div>
        )}
        {isSuccess && (
          <div className="ax-banner ok">✓ {submit.message}</div>
        )}

        {/* CTA */}
        {!connected ? (
          <button onClick={() => onConnectWallet?.()} className="ax-cta connect">Connect Wallet</button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isBusy || !quote || !stakeValid || !addrValid}
            className="ax-cta"
          >
            {isBusy ? 'Processing…' :
             isSuccess ? 'Submitted ✓' :
             !stakeValid ? `Enter ${MIN_SOL}–${MAX_SOL} SOL` :
             !addrValid ? 'Enter BTC address' :
             !quote ? (quoting ? 'Getting quote…' : 'No quote') :
             `Bridge ${n.toFixed(4)} SOL → BTC`}
          </button>
        )}

        <div className="ax-cta-footer">
          One signature · Atomic on Solana · Native BTC via ThorChain
        </div>
      </div>

      <div className="ax-powered">
        <span className="ax-powered-label">POWERED BY</span>
        <span className="ax-powered-name">THORCHAIN</span>
        <span className="ax-powered-sep">|</span>
        <span className="ax-powered-label">NATIVE BITCOIN</span>
      </div>
    </div>
  );
}
