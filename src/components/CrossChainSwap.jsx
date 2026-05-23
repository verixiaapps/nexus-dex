/**
 * NEXUS DEX — Cross-Chain Swap Page
 * 
 * All trades originate from Solana (OKX Solana token list for FROM field).
 * TO field: all chains/tokens via OKX cross-chain + Li.Fi combined list.
 * Routing: OKX preferred always → Li.Fi fallback if OKX unsupported/fails.
 * Slippage: fixed 5% (not user-configurable).
 * Simulation: always sim, user signs the sim tx.
 * Multi-step: Step 1 = quote+build, Step 2 = sign, Step 3 = status poll.
 * Destination address field appears when TO chain ≠ Solana.
 */

import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import { Buffer } from 'buffer';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import {
  VersionedTransaction, PublicKey, LAMPORTS_PER_SOL,
  TransactionInstruction, TransactionMessage, AddressLookupTableAccount,
} from '@solana/web3.js';

/* ─────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────── */
const SLIPPAGE        = '5';
const OKX_SOL_NATIVE  = '11111111111111111111111111111111';
const WSOL_MINT       = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA     = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OKX_SOLANA_IDX  = '501';
const SOL_RESERVE     = 1_000_000; // lamports kept back
const QUOTE_DEBOUNCE  = 400;
const STATUS_POLL_MS  = 3_000;
const STATUS_MAX_TRIES= 40;

/* ─────────────────────────────────────────────
   DESIGN TOKENS  (matches existing Nexus palette)
───────────────────────────────────────────── */
const C = {
  bg:        '#03060f',
  card:      '#080d1a',
  card2:     '#0c1220',
  card3:     '#111d30',
  border:    'rgba(0,229,255,0.10)',
  borderHi:  'rgba(0,229,255,0.28)',
  accent:    '#00e5ff',
  green:     '#00ffa3',
  red:       '#ff3b6b',
  orange:    '#ff9500',
  text:      '#cdd6f4',
  muted:     '#586994',
  muted2:    '#2e3f5e',
  buyGrad:   'linear-gradient(135deg,#00e5ff,#0055ff)',
  successGrad:'linear-gradient(135deg,#00ffa3,#00b36b)',
};

/* ─────────────────────────────────────────────
   CHAIN META
───────────────────────────────────────────── */
const CHAIN_META = {
  '1':    { name:'Ethereum',  symbol:'ETH',  color:'#627eea', icon:'⟠' },
  '56':   { name:'BNB Chain', symbol:'BNB',  color:'#f0b90b', icon:'◈' },
  '137':  { name:'Polygon',   symbol:'MATIC',color:'#8247e5', icon:'⬡' },
  '42161':{ name:'Arbitrum',  symbol:'ETH',  color:'#2d374b', icon:'◎' },
  '10':   { name:'Optimism',  symbol:'ETH',  color:'#ff0420', icon:'⊕' },
  '43114':{ name:'Avalanche', symbol:'AVAX', color:'#e84142', icon:'△' },
  '8453': { name:'Base',      symbol:'ETH',  color:'#0052ff', icon:'⬤' },
  '501':  { name:'Solana',    symbol:'SOL',  color:'#9945ff', icon:'◎' },
};
function chainName(id) { return CHAIN_META[String(id)]?.name || 'Chain '+id; }
function chainColor(id) { return CHAIN_META[String(id)]?.color || C.accent; }
function isEvmChain(id) { return String(id) !== '501'; }

/* ─────────────────────────────────────────────
   FORMATTERS
───────────────────────────────────────────── */
function trimZeros(v) {
  return String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
}
function displayDec(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return 4;
  if (v < 0.00000001) return 12;
  if (v < 0.000001)   return 10;
  if (v < 0.01)       return 8;
  if (v < 1)          return 6;
  return 4;
}
function fmtAmt(n) {
  if (n == null || isNaN(n)) return '0';
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9) return trimZeros((v/1e9).toFixed(2))+'B';
  if (v >= 1e6) return trimZeros((v/1e6).toFixed(2))+'M';
  if (v >= 1000) return v.toLocaleString('en-US',{maximumFractionDigits:2});
  return trimZeros(v.toFixed(displayDec(v)));
}
function fmtUsd(n, d=2) {
  if (n == null || isNaN(n)) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return '$'+trimZeros((v/1e9).toFixed(2))+'B';
  if (v >= 1e6) return '$'+trimZeros((v/1e6).toFixed(2))+'M';
  if (v >= 1000) return '$'+v.toLocaleString('en-US',{maximumFractionDigits:d});
  if (v >= 1) return '$'+v.toFixed(d);
  if (v > 0) return '$'+trimZeros(v.toFixed(v < 0.000001 ? 10 : 8));
  return '$0.00';
}
function fmtInput(n, dec=9) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  const max = Math.min(Math.max(Number(dec)||6, 0), 12);
  return trimZeros(v.toFixed(max));
}
function toRaw(s, dec) {
  if (!s || dec == null) return '0';
  let v = String(s).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!v || v.startsWith('-')) return '0';
  if (/e/i.test(v)) { const n = Number(v); if (!Number.isFinite(n)||n<0) return '0'; v = n.toFixed(Math.max(Number(dec)||0,20)); }
  const d = Math.floor(Number(dec));
  if (!Number.isFinite(d)||d<0||d>18) return '0';
  const [w, f=''] = v.split('.');
  const sw = (w||'0').replace(/[^\d]/g,'').replace(/^0+(?=\d)/,'')||'0';
  const ft = (f||'').replace(/[^\d]/g,'').slice(0,d);
  const fp = (ft+'0'.repeat(d)).slice(0,d);
  try { return (BigInt(sw)*(10n**BigInt(d))+BigInt(fp)).toString(); } catch { return '0'; }
}
function shortAddr(a, n=6) {
  if (!a) return '';
  return a.slice(0,n)+'...'+a.slice(-4);
}

/* ─────────────────────────────────────────────
   ADDRESS VALIDATION
───────────────────────────────────────────── */
function validateDestAddress(address, chainId) {
  if (!address || !address.trim()) return 'Destination address required';
  const a = address.trim();
  if (isEvmChain(chainId)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'Invalid EVM address (must be 0x + 40 hex chars)';
  } else {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'Invalid Solana address';
  }
  return null;
}

/* ─────────────────────────────────────────────
   TOKEN HELPERS
───────────────────────────────────────────── */
function isValidSolMint(s) {
  return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function toOkxSolAddr(m) { return m === WSOL_MINT ? OKX_SOL_NATIVE : m; }

/* ─────────────────────────────────────────────
   OKX SOLANA TOKEN CACHE (FROM field)
───────────────────────────────────────────── */
let _solCache = null;
let _solLoading = null;

function loadSolTokens() {
  if (_solCache) return Promise.resolve(_solCache);
  if (_solLoading) return _solLoading;
  _solLoading = fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501')
    .then(r => r.ok ? r.json() : { data: [] })
    .catch(() => ({ data: [] }))
    .then(j => {
      const tokens = (j.data || []).map(t => {
        const dec = parseInt(t.decimals);
        return {
          chain: 'solana', chainId: '501',
          mint: t.tokenContractAddress,
          address: t.tokenContractAddress,
          symbol: t.tokenSymbol || '',
          name: t.tokenName || t.tokenSymbol || '',
          decimals: Number.isFinite(dec) ? dec : 6,
          logoURI: t.tokenLogoUrl || null,
        };
      }).filter(t => isValidSolMint(t.mint) && t.symbol);
      _solCache = tokens;
      _solLoading = null;
      return tokens;
    })
    .catch(e => { _solLoading = null; throw e; });
  return _solLoading;
}

function getSolToken(mint) {
  if (!_solCache || !mint) return null;
  return _solCache.find(t => t.mint === mint) || null;
}

function getDecimalsFor(token) {
  if (!token) return 6;
  if (token.mint === WSOL_MINT || token.mint === OKX_SOL_NATIVE) return 9;
  if (token.mint === USDC_SOLANA) return 6;
  const cached = getSolToken(token.mint);
  if (cached && Number.isFinite(Number(cached.decimals))) return Number(cached.decimals);
  const d = Number(token.decimals);
  return (Number.isFinite(d) && d >= 0 && d <= 18) ? d : 6;
}

/* ─────────────────────────────────────────────
   CROSS-CHAIN TOKEN CACHE (TO field)
   Merges OKX cross-chain token list + Li.Fi token list
───────────────────────────────────────────── */
let _crossCache = null;
let _crossLoading = null;

async function fetchOkxCrossTokens() {
  try {
    const r = await fetch('/api/okx/dex/cross-chain/tokens');
    const j = await r.json();
    if (j.code !== '0' || !j.data) return [];
    return (Array.isArray(j.data) ? j.data : []).map(t => ({
      source: 'okx',
      chainId: String(t.chainIndex || t.chainId || ''),
      address: t.tokenContractAddress || t.address || '',
      symbol: t.tokenSymbol || t.symbol || '',
      name: t.tokenName || t.name || t.tokenSymbol || '',
      decimals: Number(t.decimals) || 6,
      logoURI: t.tokenLogoUrl || t.logoURI || null,
    })).filter(t => t.chainId && t.address && t.symbol);
  } catch { return []; }
}

async function fetchLifiTokens() {
  try {
    const r = await fetch('/api/lifi/tokens', { headers: { Accept: 'application/json' } });
    const j = await r.json();
    if (!j.tokens) return [];
    const all = [];
    for (const [chainId, tokens] of Object.entries(j.tokens)) {
      for (const t of (tokens || [])) {
        all.push({
          source: 'lifi',
          chainId: String(chainId),
          address: t.address || '',
          symbol: t.symbol || '',
          name: t.name || t.symbol || '',
          decimals: Number(t.decimals) || 18,
          logoURI: t.logoURI || null,
        });
      }
    }
    return all.filter(t => t.chainId && t.address && t.symbol);
  } catch { return []; }
}

function loadCrossTokens() {
  if (_crossCache) return Promise.resolve(_crossCache);
  if (_crossLoading) return _crossLoading;
  _crossLoading = Promise.all([fetchOkxCrossTokens(), fetchLifiTokens()])
    .then(([okx, lifi]) => {
      const seen = new Set();
      const merged = [];
      // OKX first (preferred)
      for (const t of okx) {
        const key = t.chainId + ':' + t.address.toLowerCase();
        if (!seen.has(key)) { seen.add(key); merged.push(t); }
      }
      // Li.Fi fills in the rest
      for (const t of lifi) {
        const key = t.chainId + ':' + t.address.toLowerCase();
        if (!seen.has(key)) { seen.add(key); merged.push({ ...t, source: 'lifi' }); }
      }
      _crossCache = merged;
      _crossLoading = null;
      return merged;
    })
    .catch(e => { _crossLoading = null; throw e; });
  return _crossLoading;
}

/* ─────────────────────────────────────────────
   DEFAULT TOKENS
───────────────────────────────────────────── */
const DEFAULT_FROM = {
  chain: 'solana', chainId: '501',
  mint: WSOL_MINT, address: WSOL_MINT,
  symbol: 'SOL', name: 'Solana', decimals: 9,
  logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const DEFAULT_TO = {
  source: 'okx', chainId: '1',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC', name: 'USD Coin', decimals: 6,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

/* ─────────────────────────────────────────────
   QUOTE / SWAP API CALLS
───────────────────────────────────────────── */
async function fetchOkxCrossQuote({ fromToken, toToken, amount, userWallet }) {
  const params = new URLSearchParams({
    fromChainIndex: OKX_SOLANA_IDX,
    toChainIndex:   toToken.chainId,
    fromTokenAddress: toOkxSolAddr(fromToken.mint || fromToken.address),
    toTokenAddress:   toToken.address,
    amount:           String(amount),
    slippage:         SLIPPAGE,
    userWalletAddress: userWallet,
  });
  const r = await fetch('/api/okx/dex/cross-chain/quote?' + params);
  const j = await r.json();
  if (j.code !== '0' || !j.data) throw new Error(j.msg || 'OKX cross-chain quote failed');
  const d = Array.isArray(j.data) ? j.data[0] : j.data;
  return { engine: 'okx', raw: d };
}

async function fetchOkxCrossBuildTx({ fromToken, toToken, amount, userWallet, destAddress }) {
  const params = new URLSearchParams({
    fromChainIndex:   OKX_SOLANA_IDX,
    toChainIndex:     toToken.chainId,
    fromTokenAddress: toOkxSolAddr(fromToken.mint || fromToken.address),
    toTokenAddress:   toToken.address,
    amount:           String(amount),
    slippage:         SLIPPAGE,
    userWalletAddress: userWallet,
    receiveAddress:   destAddress || userWallet,
  });
  const r = await fetch('/api/okx/dex/cross-chain/build-tx?' + params);
  const j = await r.json();
  if (j.code !== '0' || !j.data) throw new Error(j.msg || 'OKX build-tx failed');
  return Array.isArray(j.data) ? j.data[0] : j.data;
}

async function fetchLifiQuote({ fromToken, toToken, amount, userWallet, destAddress }) {
  const params = new URLSearchParams({
    fromChain:   OKX_SOLANA_IDX,
    toChain:     toToken.chainId,
    fromToken:   fromToken.mint || fromToken.address,
    toToken:     toToken.address,
    fromAmount:  String(amount),
    fromAddress: userWallet,
    toAddress:   destAddress || userWallet,
    slippage:    '0.05',
  });
  const r = await fetch('/api/lifi/quote?' + params);
  const j = await r.json();
  if (!j.estimate) throw new Error(j.message || 'LI.FI quote failed');
  return { engine: 'lifi', raw: j };
}

async function pollOkxCrossStatus(orderId) {
  const r = await fetch(`/api/okx/dex/cross-chain/status?orderId=${encodeURIComponent(orderId)}`);
  const j = await r.json();
  if (j.code !== '0') throw new Error(j.msg || 'Status check failed');
  return j.data;
}

async function pollLifiStatus(txHash, fromChain, toChain) {
  const r = await fetch(`/api/lifi/status?txHash=${txHash}&fromChain=${fromChain}&toChain=${toChain}`);
  const j = await r.json();
  return j;
}

/* ─────────────────────────────────────────────
   SOLANA TX BUILDER (same pattern as SwapWidget)
───────────────────────────────────────────── */
function deserializeIx(ix) {
  try {
    if (!ix || !ix.programId || !Array.isArray(ix.accounts) || !ix.data) return null;
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map(a => ({
        pubkey: new PublicKey(a.pubkey || a.publicKey || a.address),
        isSigner: !!a.isSigner,
        isWritable: !!a.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    });
  } catch { return null; }
}

async function buildSolanaTx({ connection, userPubkey, txData }) {
  // txData can come from OKX build-tx response
  if (txData?.tx?.data) {
    try { return VersionedTransaction.deserialize(Buffer.from(txData.tx.data, 'base64')); } catch {}
  }
  if (txData?.data && typeof txData.data === 'string') {
    try { return VersionedTransaction.deserialize(Buffer.from(txData.data, 'base64')); } catch {}
  }
  // Fallback: build from instruction lists
  const ixs = (txData?.instructionLists || []).map(deserializeIx).filter(Boolean);
  if (!ixs.length) throw new Error('No usable instructions from cross-chain build-tx');
  const lta = Array.isArray(txData?.addressLookupTableAccount) ? txData.addressLookupTableAccount : [];
  const lts = (await Promise.all(lta.map(async a => {
    try {
      const acct = await connection.getAccountInfo(new PublicKey(a));
      if (!acct) return null;
      return new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acct.data) });
    } catch { return null; }
  }))).filter(Boolean);
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: userPubkey, recentBlockhash: blockhash, instructions: ixs })
      .compileToV0Message(lts)
  );
}

/* ─────────────────────────────────────────────
   BODY SCROLL LOCK / ESCAPE KEY
───────────────────────────────────────────── */
let _bl = 0;
function useBodyScrollLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bl === 0) document.body.classList.add('nexus-scroll-locked');
    _bl++;
    return () => { _bl = Math.max(0, _bl - 1); if (_bl === 0) document.body.classList.remove('nexus-scroll-locked'); };
  }, [open]);
}
function useEscapeKey(open, handler) {
  useEffect(() => {
    if (!open) return;
    const fn = e => { if (e.key === 'Escape') { e.stopPropagation(); handler?.(); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, handler]);
}

/* ─────────────────────────────────────────────
   TOKEN ICON
───────────────────────────────────────────── */
function TokenIcon({ token, size = 32 }) {
  const [err, setErr] = useState(false);
  if (token?.logoURI && !err)
    return <img src={token.logoURI} alt="" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} onError={() => setErr(true)} />;
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * .4), fontWeight: 700, color: C.accent }}>
      {ch}
    </div>
  );
}

/* ─────────────────────────────────────────────
   CHAIN BADGE
───────────────────────────────────────────── */
function ChainBadge({ chainId, small = false }) {
  const meta = CHAIN_META[String(chainId)];
  const color = meta?.color || C.muted;
  const name = meta?.name || ('Chain ' + chainId);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: color + '22', border: '1px solid ' + color + '55',
      borderRadius: 6, padding: small ? '2px 6px' : '3px 8px',
      fontSize: small ? 9 : 10, color, fontWeight: 700, fontFamily: 'Syne, sans-serif',
    }}>
      <div style={{ width: small ? 5 : 6, height: small ? 5 : 6, borderRadius: '50%', background: color }} />
      {name}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SOURCE BADGE (OKX / LI.FI)
───────────────────────────────────────────── */
function RouteBadge({ engine }) {
  if (!engine) return null;
  const isOkx = engine === 'okx';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: isOkx ? 'rgba(0,229,255,.08)' : 'rgba(0,255,163,.08)',
      border: '1px solid ' + (isOkx ? 'rgba(0,229,255,.25)' : 'rgba(0,255,163,.25)'),
      borderRadius: 6, padding: '2px 8px',
      fontSize: 10, color: isOkx ? C.accent : C.green, fontWeight: 700,
      fontFamily: 'Syne, sans-serif',
    }}>
      {isOkx ? '⬡ OKX' : '⟁ Li.Fi'}
    </div>
  );
}

/* ─────────────────────────────────────────────
   STEP PROGRESS
───────────────────────────────────────────── */
function StepProgress({ step }) {
  // step: 0=idle, 1=quoting, 2=building, 3=signing, 4=pending, 5=done, -1=error
  const steps = [
    { label: 'Quote',  id: 1 },
    { label: 'Build',  id: 2 },
    { label: 'Sign',   id: 3 },
    { label: 'Bridge', id: 4 },
    { label: 'Done',   id: 5 },
  ];
  if (step <= 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '14px 0 10px' }}>
      {steps.map((s, i) => {
        const done = step > s.id;
        const active = step === s.id;
        const err = step === -1 && s.id === Math.max(1, Math.min(step, 4));
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, fontFamily: 'Syne, sans-serif',
                background: done ? C.green : active ? C.accent : err ? C.red : C.card3,
                color: (done || active) ? '#000' : err ? '#fff' : C.muted,
                border: active ? '2px solid ' + C.accent : done ? '2px solid ' + C.green : '2px solid ' + C.muted2,
                boxShadow: active ? '0 0 12px ' + C.accent + '66' : done ? '0 0 8px ' + C.green + '44' : 'none',
                transition: 'all .3s ease',
              }}>
                {done ? '✓' : s.id}
              </div>
              <div style={{ fontSize: 9, color: done ? C.green : active ? C.accent : C.muted, marginTop: 3, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 2, flex: 1, background: done ? C.green : C.muted2, marginBottom: 14, transition: 'background .3s ease' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   FROM TOKEN MODAL (Solana only, OKX list)
───────────────────────────────────────────── */
function FromTokenModal({ open, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadSolTokens().then(() => setLoading(false)).catch(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    if (!t) { setResults([]); return; }
    const timer = setTimeout(() => {
      const tokens = _solCache || [];
      const matches = tokens.filter(tk =>
        tk.symbol?.toLowerCase().includes(t) ||
        tk.name?.toLowerCase().includes(t) ||
        tk.mint?.toLowerCase().includes(t)
      ).slice(0, 40);
      setResults(matches);
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  const close = useCallback(() => { setQ(''); setResults([]); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscapeKey(open, close);

  const popular = [DEFAULT_FROM, {
    chain: 'solana', chainId: '501', mint: USDC_SOLANA, address: USDC_SOLANA,
    symbol: 'USDC', name: 'USD Coin', decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  }];

  const display = q.trim() ? results : popular;

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 440, maxHeight: 'min(85vh,100dvh)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Syne, sans-serif' }}>From Token <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· Solana</span></div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, symbol, or address..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', boxSizing: 'border-box' }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading tokens…</div>}
          {!q.trim() && !loading && <div style={{ padding: '8px 16px 4px', fontSize: 10, color: C.muted, fontWeight: 700 }}>POPULAR</div>}
          {display.length === 0 && !loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>No matches</div>}
          {display.map((t, i) => (
            <div key={(t.mint || '') + i} onClick={() => { onSelect(t); close(); }} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}>
              <TokenIcon token={t} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>{t.name}</div>
              </div>
              <ChainBadge chainId="501" small />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   TO TOKEN MODAL (all chains, OKX + Li.Fi)
───────────────────────────────────────────── */
function ToTokenModal({ open, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [allTokens, setAllTokens] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedChain, setSelectedChain] = useState('all');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadCrossTokens()
      .then(tokens => { setAllTokens(tokens); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open]);

  const chains = useMemo(() => {
    const ids = new Set(allTokens.map(t => t.chainId));
    return ['all', ...Array.from(ids).sort((a, b) => {
      const order = ['1','56','137','42161','10','43114','8453','501'];
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    })];
  }, [allTokens]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    const filtered = selectedChain === 'all' ? allTokens : allTokens.filter(tk => tk.chainId === selectedChain);
    if (!t) {
      // Show popular defaults when no query
      const pop = filtered.filter(tk =>
        ['USDC','USDT','ETH','BNB','MATIC','AVAX','SOL','WETH'].includes(tk.symbol?.toUpperCase())
      ).slice(0, 20);
      setResults(pop);
      return;
    }
    const timer = setTimeout(() => {
      const matches = filtered.filter(tk =>
        tk.symbol?.toLowerCase().includes(t) ||
        tk.name?.toLowerCase().includes(t) ||
        tk.address?.toLowerCase().includes(t)
      ).slice(0, 50);
      setResults(matches);
    }, 150);
    return () => clearTimeout(timer);
  }, [q, allTokens, selectedChain]);

  const close = useCallback(() => { setQ(''); setResults([]); setSelectedChain('all'); onClose(); }, [onClose]);
  useBodyScrollLock(open);
  useEscapeKey(open, close);

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.8)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 460, maxHeight: 'min(88vh,100dvh)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Syne, sans-serif' }}>To Token <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· All Chains</span></div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, symbol, or address..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 10, boxSizing: 'border-box' }} />
          {/* Chain filter pills */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {chains.map(id => {
              const meta = id === 'all' ? null : CHAIN_META[id];
              const active = selectedChain === id;
              return (
                <button key={id} onClick={() => setSelectedChain(id)} style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 20,
                  border: active ? '1px solid ' + (meta?.color || C.accent) : '1px solid ' + C.muted2,
                  background: active ? (meta?.color || C.accent) + '22' : 'transparent',
                  color: active ? (meta?.color || C.accent) : C.muted,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif',
                }}>
                  {id === 'all' ? 'All' : (meta?.name || 'Chain ' + id)}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading tokens…</div>}
          {!loading && results.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: C.muted }}>No matches</div>}
          {results.map((t, i) => (
            <div key={t.chainId + ':' + t.address + i} onClick={() => { onSelect(t); close(); }} style={{ padding: '11px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.03)' }}>
              <TokenIcon token={t} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{t.symbol}</div>
                <div style={{ color: C.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <ChainBadge chainId={t.chainId} small />
                {t.source === 'lifi' && <div style={{ fontSize: 8, color: C.muted, fontFamily: 'Syne, sans-serif' }}>via Li.Fi</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   MAIN PAGE COMPONENT
───────────────────────────────────────────── */
export default function CrossChainSwap({ onConnectWallet }) {
  const { publicKey: extPk, sendTransaction: extSendTx, connected: solCon } = useWallet();
  const { connection } = useConnection();
  const nexus = useNexusWallet();
  const { activeWalletKind, privyEmbeddedSol } = nexus;

  /* ── Wallet resolution ── */
  const pubkey = useMemo(() => {
    if (extPk) return extPk;
    if (privyEmbeddedSol?.address) { try { return new PublicKey(privyEmbeddedSol.address); } catch { return null; } }
    return null;
  }, [extPk, privyEmbeddedSol]);

  const isConnected = !!(solCon || (privyEmbeddedSol && pubkey));

  // Only Phantom / WalletConnect — gate Privy
  const canUse = isConnected && activeWalletKind !== 'privy';

  const sendTx = useCallback(async (tx, conn) => {
    if (activeWalletKind === 'privy' && privyEmbeddedSol) {
      if (typeof privyEmbeddedSol.sendTransaction === 'function')
        return privyEmbeddedSol.sendTransaction(tx, conn, { skipPreflight: false, preflightCommitment: 'processed', maxRetries: 3 });
      if (typeof privyEmbeddedSol.signTransaction === 'function') {
        const signed = await privyEmbeddedSol.signTransaction(tx);
        return conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'processed', maxRetries: 3 });
      }
      throw new Error('Wallet does not support sending');
    }
    return extSendTx(tx, conn, { skipPreflight: false, preflightCommitment: 'processed', maxRetries: 3 });
  }, [activeWalletKind, privyEmbeddedSol, extSendTx]);

  /* ── Token state ── */
  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken, setToToken]     = useState(DEFAULT_TO);
  const [fromAmt, setFromAmt]     = useState('');

  /* ── Destination address ── */
  const needsDestAddr = toToken && toToken.chainId !== '501';
  const [destAddr, setDestAddr]   = useState('');
  const [addrError, setAddrError] = useState('');

  /* ── Quote state ── */
  const [quote, setQuote]         = useState(null);  // { engine, outAmount, outAmountDisplay, estimatedTime, fee }
  const [quoteErr, setQuoteErr]   = useState('');
  const [quoting, setQuoting]     = useState(false);

  /* ── Swap execution state ── */
  // step: 0=idle, 1=quoting, 2=building, 3=signing, 4=pending, 5=done, -1=error
  const [step, setStep]           = useState(0);
  const [swapErr, setSwapErr]     = useState('');
  const [txHash, setTxHash]       = useState(null);
  const [orderId, setOrderId]     = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  /* ── Balance ── */
  const [solBal, setSolBal]       = useState(null);
  const [tokBal, setTokBal]       = useState(null);

  /* ── Token modal state ── */
  const [fromModalOpen, setFromModalOpen] = useState(false);
  const [toModalOpen, setToModalOpen]     = useState(false);

  /* ── Prices for USD display ── */
  const [fromPrice, setFromPrice] = useState(null);
  const [toPrice, setToPrice]     = useState(null);

  /* ── Load token lists on mount ── */
  useEffect(() => {
    loadSolTokens().catch(() => {});
    loadCrossTokens().catch(() => {});
  }, []);

  /* ── Balance fetch ── */
  useEffect(() => {
    if (!pubkey || !connection) { setSolBal(null); setTokBal(null); return; }
    let cancelled = false;
    connection.getBalance(pubkey).then(b => { if (!cancelled) setSolBal(b); }).catch(() => {});
    if (fromToken?.mint && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(fromToken.mint) })
        .then(a => { if (!cancelled) setTokBal(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); })
        .catch(() => {});
    } else { setTokBal(null); }
    return () => { cancelled = true; };
  }, [pubkey, connection, fromToken]);

  const displayBalance = useMemo(() => {
    if (fromToken?.mint === WSOL_MINT) return solBal != null ? Math.max(0, (solBal - SOL_RESERVE) / LAMPORTS_PER_SOL) : null;
    return tokBal;
  }, [fromToken, solBal, tokBal]);

  /* ── From price (for USD estimate) ── */
  useEffect(() => {
    if (!fromToken?.mint) return;
    let cancelled = false;
    const mint = fromToken.mint === OKX_SOL_NATIVE ? WSOL_MINT : fromToken.mint;
    if (mint === USDC_SOLANA) { setFromPrice(1); return; }
    const dec = getDecimalsFor(fromToken);
    const amount = (10n ** BigInt(dec)).toString();
    fetch(`/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${toOkxSolAddr(mint)}&toTokenAddress=${USDC_SOLANA}&amount=${amount}`)
      .then(r => r.json())
      .then(j => {
        if (!cancelled && j.code === '0' && j.data) {
          const d = Array.isArray(j.data) ? j.data[0] : j.data;
          const p = Number(d.toTokenAmount) / 1e6;
          if (p > 0) setFromPrice(p);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [fromToken]);

  /* ── Debounced quote fetch ── */
  const quoteAbortRef = useRef(null);

  const fetchQuote = useCallback(async () => {
    setQuoteErr('');
    if (!fromAmt || parseFloat(fromAmt) <= 0) { setQuote(null); return; }
    if (!fromToken || !toToken) { setQuote(null); return; }

    // Validate dest address before quoting
    if (needsDestAddr && destAddr.trim()) {
      const err = validateDestAddress(destAddr, toToken.chainId);
      if (err) { setQuote(null); return; }
    }

    setQuoting(true);
    if (quoteAbortRef.current) quoteAbortRef.current.abort();
    quoteAbortRef.current = new AbortController();

    try {
      const dec = getDecimalsFor(fromToken);
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') { setQuote(null); setQuoting(false); return; }

      const wallet = pubkey?.toString() || '11111111111111111111111111111111';
      const dest = destAddr.trim() || wallet;

      let result = null;
      let engine = 'okx';

      // Try OKX first
      try {
        const q = await fetchOkxCrossQuote({ fromToken, toToken, amount: raw, userWallet: wallet });
        const d = q.raw;
        const outAmt = d.toTokenAmount
          ? Number(d.toTokenAmount) / Math.pow(10, toToken.decimals || 6)
          : (d.estimateAmount ? Number(d.estimateAmount) / Math.pow(10, toToken.decimals || 6) : null);
        result = {
          engine: 'okx',
          outAmount: outAmt,
          outAmountDisplay: outAmt != null ? fmtAmt(outAmt) : '~',
          estimatedTime: d.estimatedTime || d.crossChainFee?.estimatedTime || null,
          fee: d.crossChainFee?.totalFee || null,
        };
      } catch (okxErr) {
        console.warn('[CrossChain] OKX quote failed, trying Li.Fi:', okxErr.message);
        engine = 'lifi';
        try {
          const q = await fetchLifiQuote({ fromToken, toToken, amount: raw, userWallet: wallet, destAddress: dest });
          const outAmt = q.raw?.estimate?.toAmount
            ? Number(q.raw.estimate.toAmount) / Math.pow(10, toToken.decimals || 18)
            : null;
          result = {
            engine: 'lifi',
            outAmount: outAmt,
            outAmountDisplay: outAmt != null ? fmtAmt(outAmt) : '~',
            estimatedTime: q.raw?.estimate?.executionDuration || null,
            fee: null,
            lifiQuote: q.raw,
          };
        } catch (lifiErr) {
          throw new Error('Quote unavailable on both OKX and Li.Fi');
        }
      }

      setQuote(result);
    } catch (e) {
      setQuoteErr(e.message || 'Quote failed');
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }, [fromAmt, fromToken, toToken, destAddr, needsDestAddr, pubkey]);

  useEffect(() => {
    const timer = setTimeout(fetchQuote, QUOTE_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  /* ── Validate address on input ── */
  useEffect(() => {
    if (!needsDestAddr || !destAddr.trim()) { setAddrError(''); return; }
    const err = validateDestAddress(destAddr, toToken?.chainId);
    setAddrError(err || '');
  }, [destAddr, toToken, needsDestAddr]);

  /* ── MAX button ── */
  const onMax = useCallback(() => {
    if (displayBalance == null || displayBalance <= 0) return;
    const dec = Math.min(getDecimalsFor(fromToken) ?? 6, 9);
    setFromAmt(fmtInput(displayBalance, dec));
  }, [displayBalance, fromToken]);

  /* ── FLIP tokens (only if both are Solana) ── */
  const canFlip = toToken?.chainId === '501';
  const flip = useCallback(() => {
    if (!canFlip) return;
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmt('');
    setQuote(null);
    setQuoteErr('');
  }, [fromToken, toToken, canFlip]);

  /* ── Status polling ── */
  const pollStatus = useCallback(async (hash, engine, fromChainId, toChainId, oid) => {
    let tries = 0;
    const poll = async () => {
      if (tries++ > STATUS_MAX_TRIES) { setStatusMsg('Bridge taking longer than expected — check your wallet.'); return; }
      try {
        if (engine === 'okx' && oid) {
          const data = await pollOkxCrossStatus(oid);
          const status = Array.isArray(data) ? data[0]?.status : data?.status;
          if (status === 'SUCCESS' || status === '2') {
            setStep(5);
            setStatusMsg('Bridge complete ✓');
            return;
          }
          if (status === 'FAILED' || status === '3') {
            setStep(-1);
            setSwapErr('Bridge failed on destination chain.');
            return;
          }
          setStatusMsg('Bridging… (' + tries + ')');
        } else {
          const data = await pollLifiStatus(hash, fromChainId, toChainId);
          if (data?.status === 'DONE') { setStep(5); setStatusMsg('Bridge complete ✓'); return; }
          if (data?.status === 'FAILED') { setStep(-1); setSwapErr('Bridge failed.'); return; }
          setStatusMsg('Bridging via Li.Fi… (' + tries + ')');
        }
        setTimeout(poll, STATUS_POLL_MS);
      } catch {
        setTimeout(poll, STATUS_POLL_MS);
      }
    };
    poll();
  }, []);

  /* ── EXECUTE swap ── */
  const execute = useCallback(async () => {
    if (!canUse) { onConnectWallet?.(); return; }

    // Validate destination address
    if (needsDestAddr) {
      const err = validateDestAddress(destAddr, toToken?.chainId);
      if (err) { setAddrError(err); return; }
    }

    setStep(1);
    setSwapErr('');
    setTxHash(null);
    setOrderId(null);
    setStatusMsg('');

    try {
      const dec = getDecimalsFor(fromToken);
      const raw = toRaw(fromAmt, dec);
      if (!raw || raw === '0') throw new Error('Invalid amount');
      if (!pubkey) throw new Error('Connect Solana wallet');

      const wallet = pubkey.toString();
      const dest = (needsDestAddr ? destAddr.trim() : wallet) || wallet;

      let txData = null;
      let usedEngine = 'okx';

      // Step 1: Build TX
      setStep(2);
      try {
        txData = await fetchOkxCrossBuildTx({ fromToken, toToken, amount: raw, userWallet: wallet, destAddress: dest });
      } catch (okxErr) {
        console.warn('[CrossChain] OKX build-tx failed, using Li.Fi:', okxErr.message);
        usedEngine = 'lifi';
        // For Li.Fi, the quote has the tx data
        if (!quote?.lifiQuote?.transactionRequest) {
          // Need to re-fetch Li.Fi quote with tx included
          const q = await fetchLifiQuote({ fromToken, toToken, amount: raw, userWallet: wallet, destAddress: dest });
          txData = q.raw?.transactionRequest || null;
          if (!txData) throw new Error('Li.Fi did not return transaction data');
        } else {
          txData = quote.lifiQuote.transactionRequest;
        }
      }

      // Build the Solana versioned transaction
      const tx = await buildSolanaTx({ connection, userPubkey: pubkey, txData });

      // Step 3: Sign
      setStep(3);
      const sig = await sendTx(tx, connection);
      setTxHash(sig);

      // Extract order ID from OKX response if available
      if (usedEngine === 'okx' && txData?.orderId) {
        setOrderId(txData.orderId);
      }

      // Step 4: Poll
      setStep(4);
      setStatusMsg('Transaction sent, waiting for bridge confirmation…');
      pollStatus(sig, usedEngine, '501', toToken.chainId, txData?.orderId || null);

    } catch (e) {
      setSwapErr(e.message || 'Swap failed');
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 6000);
    }
  }, [canUse, needsDestAddr, destAddr, toToken, fromToken, fromAmt, pubkey, quote, sendTx, connection, pollStatus, onConnectWallet]);

  const reset = useCallback(() => {
    setStep(0); setSwapErr(''); setTxHash(null); setOrderId(null); setStatusMsg('');
    setFromAmt(''); setQuote(null); setQuoteErr('');
  }, []);

  /* ── Derived UI values ── */
  const fromUsd   = fromAmt && fromPrice > 0 ? parseFloat(fromAmt) * fromPrice : 0;
  const busy      = step > 0 && step < 5 && step !== -1;
  const isSuccess = step === 5;
  const isError   = step === -1;

  const solscanUrl = txHash ? 'https://solscan.io/tx/' + txHash : null;

  const btnLabel = () => {
    if (!isConnected) return 'Connect Wallet';
    if (activeWalletKind === 'privy') return 'Use Phantom or WalletConnect';
    if (step === 1) return 'Getting Quote…';
    if (step === 2) return 'Building Transaction…';
    if (step === 3) return 'Sign in Wallet…';
    if (step === 4) return 'Bridging…';
    if (isSuccess) return 'Bridge Complete ✓';
    if (isError)   return 'Try Again';
    if (!fromAmt)  return 'Enter Amount';
    if (needsDestAddr && !destAddr.trim()) return 'Enter Destination Address';
    if (addrError) return 'Invalid Address';
    return `Bridge ${fromToken?.symbol || ''} → ${toToken?.symbol || ''}`;
  };

  const btnBg = () => {
    if (isSuccess)  return C.successGrad;
    if (isError)    return 'rgba(255,59,107,.2)';
    if (!fromAmt || (needsDestAddr && !destAddr.trim()) || addrError) return C.card3;
    return C.buyGrad;
  };

  const btnColor = () => {
    if (!fromAmt || (needsDestAddr && !destAddr.trim()) || addrError) return C.muted;
    return '#fff';
  };

  /* ────────────────────────────────────────────
     RENDER
  ─────────────────────────────────────────────── */
  return (
    <div style={{ width: '100%', maxWidth: 540, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>
          Cross-Chain Swap
        </h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 5, fontFamily: 'Syne, sans-serif' }}>
          Solana → Any Chain · OKX preferred · Li.Fi fallback · 5% slippage
        </p>
      </div>

      {/* Privy wallet warning */}
      {isConnected && activeWalletKind === 'privy' && (
        <div style={{ marginBottom: 14, padding: '12px 14px', background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.25)', borderRadius: 10, fontSize: 12, color: C.orange, fontFamily: 'Syne, sans-serif' }}>
          ⚠️ Cross-chain swaps require Phantom or WalletConnect. Please switch wallets.
        </div>
      )}

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>

        {/* Step progress (shown while executing) */}
        <StepProgress step={step} />

        {/* ── FROM field ── */}
        <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>YOU SEND</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ChainBadge chainId="501" small />
              {displayBalance != null && (
                <span style={{ fontSize: 11, color: C.muted, fontFamily: 'Syne, sans-serif' }}>
                  Bal: <span style={{ color: C.text }}>{fmtAmt(displayBalance)}</span>
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => !busy && setFromModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card3, border: '1px solid ' + C.border, borderRadius: 12, padding: '9px 12px', cursor: busy ? 'default' : 'pointer', flexShrink: 0, minWidth: 110 }}
            >
              <TokenIcon token={fromToken} size={22} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>{fromToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <input
              value={fromAmt}
              onChange={e => { if (!busy) setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }}
              placeholder="0.00"
              inputMode="decimal"
              disabled={busy}
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, color: '#fff', textAlign: 'right', outline: 'none', fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.5 : 1 }}
            />
            {displayBalance > 0 && !busy && (
              <button onClick={onMax} style={{ background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 6, padding: '5px 9px', color: C.accent, fontSize: 10, fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: 'Syne, sans-serif' }}>MAX</button>
            )}
          </div>
          {fromUsd > 0 && (
            <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>{fmtUsd(fromUsd)}</div>
          )}
        </div>

        {/* ── SWAP ARROW ── */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button
            onClick={canFlip && !busy ? flip : undefined}
            title={canFlip ? 'Flip tokens' : 'Can only flip Solana↔Solana'}
            style={{ width: 42, height: 42, borderRadius: 12, background: C.card3, border: '1px solid ' + C.border, cursor: canFlip && !busy ? 'pointer' : 'default', color: canFlip ? C.accent : C.muted, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}
          >
            ⇅
          </button>
        </div>

        {/* ── TO field ── */}
        <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>YOU RECEIVE (EST.)</span>
            {toToken && <ChainBadge chainId={toToken.chainId} small />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => !busy && setToModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card3, border: '1px solid ' + C.border, borderRadius: 12, padding: '9px 12px', cursor: busy ? 'default' : 'pointer', flexShrink: 0, minWidth: 110 }}
            >
              <TokenIcon token={toToken} size={22} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>{toToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <div style={{ flex: 1, textAlign: 'right', fontSize: 24, color: quote ? C.green : C.muted2, fontFamily: 'JetBrains Mono, monospace' }}>
              {quoting ? (
                <span style={{ fontSize: 14, color: C.muted }}>Fetching…</span>
              ) : (
                quote?.outAmountDisplay || '0'
              )}
            </div>
          </div>
          {/* Route badge */}
          {quote && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <RouteBadge engine={quote.engine} />
              {quote.estimatedTime && (
                <span style={{ fontSize: 10, color: C.muted, fontFamily: 'Syne, sans-serif' }}>
                  ~{Math.ceil(Number(quote.estimatedTime) / 60)} min
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── DESTINATION ADDRESS ── */}
        {needsDestAddr && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 6, fontFamily: 'Syne, sans-serif' }}>
              DESTINATION ADDRESS
              <span style={{ marginLeft: 6, color: chainColor(toToken?.chainId), fontWeight: 400 }}>
                · {chainName(toToken?.chainId)}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                value={destAddr}
                onChange={e => { if (!busy) setDestAddr(e.target.value.trim()); }}
                placeholder={isEvmChain(toToken?.chainId) ? '0x...' : 'Solana address'}
                disabled={busy}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: C.card2,
                  border: '1px solid ' + (addrError ? C.red : destAddr && !addrError ? C.green : C.border),
                  borderRadius: 10, padding: '12px 14px',
                  color: '#fff', fontSize: 13, outline: 'none',
                  fontFamily: 'JetBrains Mono, monospace',
                  opacity: busy ? 0.5 : 1,
                }}
              />
              {destAddr && !addrError && (
                <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: C.green, fontSize: 14 }}>✓</div>
              )}
            </div>
            {addrError && (
              <div style={{ marginTop: 5, fontSize: 11, color: C.red, fontFamily: 'Syne, sans-serif' }}>{addrError}</div>
            )}
            {destAddr && !addrError && (
              <div style={{ marginTop: 5, fontSize: 11, color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}>{shortAddr(destAddr, 10)}</div>
            )}
          </div>
        )}

        {/* ── QUOTE SUMMARY ── */}
        {quote && fromAmt && (
          <div style={{ marginTop: 14, background: '#050912', borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
            {[
              ['Route', <RouteBadge key="rb" engine={quote.engine} />],
              ['Slippage', '5% (fixed)'],
              ['Est. time', quote.estimatedTime ? `~${Math.ceil(Number(quote.estimatedTime) / 60)} min` : '—'],
              ['Simulation', 'Always on'],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                <span style={{ color: C.muted, fontFamily: 'Syne, sans-serif' }}>{label}</span>
                <span style={{ color: C.text, fontFamily: 'Syne, sans-serif' }}>{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── QUOTE ERROR ── */}
        {quoteErr && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.2)', borderRadius: 8, fontSize: 12, color: C.red, fontFamily: 'Syne, sans-serif' }}>
            {quoteErr}
          </div>
        )}

        {/* ── SWAP ERROR ── */}
        {swapErr && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red, fontFamily: 'Syne, sans-serif' }}>
            {swapErr}
          </div>
        )}

        {/* ── STATUS MSG (while bridging) ── */}
        {statusMsg && step === 4 && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 8, fontSize: 12, color: C.accent, fontFamily: 'Syne, sans-serif' }}>
            {statusMsg}
          </div>
        )}

        {/* ── SUCCESS MSG ── */}
        {isSuccess && (
          <div style={{ marginTop: 10, padding: '14px', background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🎉</div>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Bridge Complete!</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 4, fontFamily: 'Syne, sans-serif' }}>{statusMsg}</div>
          </div>
        )}

        {/* ── ACTION BUTTON ── */}
        {!isSuccess ? (
          <button
            onClick={isError ? reset : (!canUse ? () => onConnectWallet?.() : execute)}
            disabled={busy && !isError}
            style={{
              width: '100%', marginTop: 16, padding: 16, borderRadius: 14, border: 'none',
              background: btnBg(), color: btnColor(),
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
              cursor: busy ? 'not-allowed' : 'pointer', minHeight: 54,
              transition: 'all .2s', opacity: busy ? 0.8 : 1,
            }}
          >
            {busy && <span style={{ marginRight: 8 }}>⟳</span>}
            {btnLabel()}
          </button>
        ) : (
          <button
            onClick={reset}
            style={{ width: '100%', marginTop: 16, padding: 16, borderRadius: 14, border: 'none', background: C.card3, color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 54 }}
          >
            New Swap
          </button>
        )}

        {/* ── TX LINK ── */}
        {txHash && solscanUrl && (
          <a href={solscanUrl} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent, fontFamily: 'Syne, sans-serif' }}>
            View on Solscan ↗
          </a>
        )}

        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 14, fontFamily: 'Syne, sans-serif' }}>
          Non-custodial · OKX DEX + Li.Fi · Solana origin
        </p>
      </div>

      {/* Modals */}
      <FromTokenModal open={fromModalOpen} onClose={() => setFromModalOpen(false)} onSelect={t => { setFromToken(t); setQuote(null); setQuoteErr(''); }} />
      <ToTokenModal   open={toModalOpen}   onClose={() => setToModalOpen(false)}   onSelect={t => { setToToken(t); setQuote(null); setQuoteErr(''); setDestAddr(''); setAddrError(''); }} />
    </div>
  );
}
