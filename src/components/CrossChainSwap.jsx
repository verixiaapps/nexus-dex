/**
 * NEXUS DEX — Cross-Chain Swap
 *
 * Engine:    Li.Fi SDK (@lifi/sdk) — same pattern as PerpsLanding.jsx
 * From:      Solana tokens (OKX token list for search)
 * To:        All chains via Li.Fi
 * Fee:       5% via integratorFee + integratorFeeRecipient in lifiCreateConfig
 * Wallet:    Phantom / WalletConnect only (solana wallet adapter)
 * Slippage:  Fixed 0.05
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createConfig as lifiCreateConfig,
  config as lifiConfig,
  Solana as LifiSolana,
  getRoutes as lifiGetRoutes,
  executeRoute as lifiExecuteRoute,
  getTokens as lifiGetTokens,
  getChains as lifiGetChains,
} from '@lifi/sdk';

/* ─── CONFIG — replace with your wallet ─── */
const LIFI_INTEGRATOR       = 'NexusDEX';
const LIFI_FEE_RECIPIENT    = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const LIFI_FEE              = 0.05; // 5%

/* ─── CONSTANTS ─── */
const WSOL_MINT          = 'So11111111111111111111111111111111111111112';
const SOL_MINT           = '11111111111111111111111111111111';
const USDC_SOLANA        = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RESERVE        = 1_000_000; // lamports kept back
const QUOTE_DEBOUNCE_MS  = 250;
const OKX_PRICE_CACHE_MS = 60_000;
const LIFI_SOLANA_CHAIN  = 1151111081099710;

/* ─── DESIGN TOKENS (exact match to SwapWidget / PerpsLanding) ─── */
const C = {
  bg:'#03060f', card:'#080d1a', card2:'#0c1220', card3:'#111d30',
  border:'rgba(0,229,255,0.10)', borderHi:'rgba(0,229,255,0.25)',
  accent:'#00e5ff', green:'#00ffa3', red:'#ff3b6b', orange:'#ff9500',
  text:'#cdd6f4', muted:'#586994', muted2:'#2e3f5e',
  buyGrad:'linear-gradient(135deg,#00e5ff,#0055ff)',
  successGrad:'linear-gradient(135deg,#00ffa3,#00b36b)',
};

/* ─── CHAIN META ─── */
const CHAIN_META = {
  '1':     { name:'Ethereum',  color:'#627eea' },
  '56':    { name:'BNB Chain', color:'#f0b90b' },
  '137':   { name:'Polygon',   color:'#8247e5' },
  '42161': { name:'Arbitrum',  color:'#28a0f0' },
  '10':    { name:'Optimism',  color:'#ff0420' },
  '43114': { name:'Avalanche', color:'#e84142' },
  '8453':  { name:'Base',      color:'#0052ff' },
  '59144': { name:'Linea',     color:'#61dfff' },
  '324':   { name:'zkSync',    color:'#8c8dfc' },
  '100':   { name:'Gnosis',    color:'#04795b' },
  [String(LIFI_SOLANA_CHAIN)]: { name:'Solana', color:'#9945ff' },
};
function chainName(id) { return CHAIN_META[String(id)]?.name || 'Chain ' + id; }
function chainColor(id) { return CHAIN_META[String(id)]?.color || C.accent; }
function isEvm(id) { return String(id) !== String(LIFI_SOLANA_CHAIN); }

/* ─── FORMATTERS (exact copies from SwapWidget) ─── */
function trimZeros(v) {
  return String(v).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
}
function displayDecimalsForValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 4;
  if (v === 0) return 2;
  if (v < 0.00000001) return 12;
  if (v < 0.000001)   return 10;
  if (v < 0.01)       return 8;
  if (v < 1)          return 6;
  return 4;
}
function fmtTokenDisplay(n) {
  if (n == null || isNaN(n)) return '0';
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (v >= 1e9) return trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6) return trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return trimZeros(v.toFixed(displayDecimalsForValue(v)));
}
function fmtInputAmount(n, dec = 9) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  const max = Math.min(Math.max(Number(dec) || 6, 0), 12);
  return trimZeros(v.toFixed(max));
}
function fmtUsd(n, d = 2) {
  if (n == null || isNaN(n)) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  if (v >= 1e9) return '$' + trimZeros((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6) return '$' + trimZeros((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: d });
  if (v >= 1) return '$' + v.toFixed(d);
  if (v > 0) return '$' + trimZeros(v.toFixed(v < 0.000001 ? 10 : 8));
  return '$0.00';
}
function toRawAmount(s, dec) {
  if (!s || dec == null) return '0';
  let v = String(s).trim().replace(/,/g, '.').replace(/^\+/, '');
  if (!v || v.startsWith('-')) return '0';
  if (/e/i.test(v)) { const n = Number(v); if (!Number.isFinite(n) || n < 0) return '0'; v = n.toFixed(Math.max(Number(dec) || 0, 20)); }
  const d = Math.floor(Number(dec));
  if (!Number.isFinite(d) || d < 0 || d > 18) return '0';
  const [w, f = ''] = v.split('.');
  const sw = (w || '0').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const ft = (f || '').replace(/[^\d]/g, '').slice(0, d);
  const fp = (ft + '0'.repeat(d)).slice(0, d);
  try { return (BigInt(sw) * (10n ** BigInt(d)) + BigInt(fp)).toString(); } catch { return '0'; }
}
function maxSafeSolBalance(lamports) {
  return lamports ? Math.max(0, lamports - SOL_RESERVE) / LAMPORTS_PER_SOL : 0;
}

/* ─── ADDRESS VALIDATION ─── */
function validateDestAddress(address, chainId) {
  if (!address || !address.trim()) return 'Destination address required';
  const a = address.trim();
  if (isEvm(chainId)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return 'Invalid EVM address (0x + 40 hex chars)';
  } else {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'Invalid Solana address';
  }
  return null;
}

/* ─── TOKEN HELPERS ─── */
function isValidSolMint(s) {
  return !!s && s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function toOkxSolAddress(m) { return m === WSOL_MINT ? SOL_MINT : m; }

/* ─── OKX SOLANA TOKEN CACHE (FROM field — same as SwapWidget) ─── */
let _okxCache = null;
let _okxLoading = null;

function getOkxCachedToken(mint) {
  if (!_okxCache || !mint) return null;
  return _okxCache.find(t => t.mint === mint) || null;
}
function normalizeToken(input) {
  if (!input) return null;
  const logo = input.logoURI || input.image || input.thumbnail || null;
  const sym = input.symbol || 'TOKEN';
  const name = input.name || sym;
  const solMint = input.mint || (input.isSolanaToken ? input.id : null);
  if (!solMint || !isValidSolMint(solMint)) return null;
  let decimals = null;
  if (solMint === WSOL_MINT || solMint === SOL_MINT) decimals = 9;
  else if (solMint === USDC_SOLANA) decimals = 6;
  else {
    const okx = getOkxCachedToken(solMint);
    const okxD = Number(okx?.decimals);
    if (Number.isFinite(okxD) && okxD >= 0 && okxD <= 18) decimals = okxD;
    else { const p = Number(input.decimals); if (Number.isFinite(p) && p >= 0 && p <= 18) decimals = p; }
  }
  if (decimals == null) decimals = 6;
  return {
    chain: 'solana', chainId: String(LIFI_SOLANA_CHAIN),
    mint: solMint === SOL_MINT ? WSOL_MINT : solMint,
    address: solMint === SOL_MINT ? WSOL_MINT : solMint,
    symbol: sym, name, decimals, logoURI: logo,
  };
}
function loadOkxSolTokens() {
  if (_okxCache) return Promise.resolve(_okxCache);
  if (_okxLoading) return _okxLoading;
  _okxLoading = fetch('/api/okx/dex/aggregator/all-tokens?chainIndex=501')
    .then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] }))
    .then(j => {
      const t = (j.data || []).map(t => {
        const d = parseInt(t.decimals);
        return {
          chain: 'solana', chainId: String(LIFI_SOLANA_CHAIN),
          mint: t.tokenContractAddress, address: t.tokenContractAddress,
          symbol: t.tokenSymbol || '', name: t.tokenName || t.tokenSymbol || '',
          decimals: Number.isFinite(d) ? d : 6, logoURI: t.tokenLogoUrl || null,
        };
      }).filter(t => isValidSolMint(t.mint) && t.symbol);
      _okxCache = t; _okxLoading = null; return t;
    })
    .catch(e => { _okxLoading = null; throw e; });
  return _okxLoading;
}
function getResolvedDecimals(token) {
  if (!token) return null;
  if (token.mint === WSOL_MINT || token.mint === SOL_MINT) return 9;
  if (token.mint === USDC_SOLANA) return 6;
  const okxD = getOkxCachedToken(token.mint);
  if (okxD && Number.isFinite(Number(okxD.decimals))) return Number(okxD.decimals);
  const d = Number(token.decimals);
  if (Number.isFinite(d) && d >= 0 && d <= 18) return d;
  return 6;
}

/* ─── OKX PRICE CACHE (same as SwapWidget) ─── */
const _okxPriceCache = new Map();
function getCachedOkxPrice(mint) {
  const e = _okxPriceCache.get(mint);
  if (!e) return null;
  if (Date.now() - e.ts > OKX_PRICE_CACHE_MS) { _okxPriceCache.delete(mint); return null; }
  return e.price;
}
function setCachedOkxPrice(mint, price) {
  if (!mint || price <= 0) return;
  _okxPriceCache.set(mint, { price, ts: Date.now() });
}
async function fetchOkxPrice(token) {
  const n = normalizeToken(token);
  if (!n?.mint) return null;
  const mint = n.mint;
  if (mint === USDC_SOLANA) return 1;
  const cached = getCachedOkxPrice(mint);
  if (cached != null) return cached;
  await loadOkxSolTokens().catch(() => {});
  const dec = getResolvedDecimals(n);
  if (dec == null) return null;
  const amount = (10n ** BigInt(dec)).toString();
  try {
    const r = await fetch(`/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${toOkxSolAddress(mint)}&toTokenAddress=${USDC_SOLANA}&amount=${amount}`);
    const j = await r.json();
    if (j.code === '0' && j.data) {
      const d = Array.isArray(j.data) ? j.data[0] : j.data;
      const price = Number(d.toTokenAmount) / 1e6;
      if (price > 0) { setCachedOkxPrice(mint, price); return price; }
    }
  } catch {}
  return null;
}

/* ─── LI.FI SDK CONFIG (same pattern as PerpsLanding) ─── */
let _lifiConfigured = false;
function ensureLifiConfig() {
  if (_lifiConfigured) return;
  lifiCreateConfig({
    integrator: LIFI_INTEGRATOR,
    ...(LIFI_FEE_RECIPIENT && LIFI_FEE > 0
      ? { integratorFee: LIFI_FEE, integratorFeeRecipient: LIFI_FEE_RECIPIENT }
      : {}),
  });
  _lifiConfigured = true;
}

/* ─── LI.FI TOKEN CACHE (TO field) ─── */
let _lifiTokenCache = null;
let _lifiTokenLoading = null;

function loadLifiTokens() {
  if (_lifiTokenCache) return Promise.resolve(_lifiTokenCache);
  if (_lifiTokenLoading) return _lifiTokenLoading;
  _lifiTokenLoading = (async () => {
    ensureLifiConfig();
    try {
      const result = await lifiGetTokens();
      const all = [];
      for (const [chainId, tokens] of Object.entries(result?.tokens || {})) {
        if (String(chainId) === String(LIFI_SOLANA_CHAIN)) continue; // skip Solana on TO side
        for (const t of (tokens || [])) {
          if (!t.address || !t.symbol) continue;
          all.push({
            chainId: String(chainId),
            address: t.address,
            symbol: t.symbol,
            name: t.name || t.symbol,
            decimals: Number(t.decimals) || 18,
            logoURI: t.logoURI || null,
          });
        }
      }
      _lifiTokenCache = all;
      _lifiTokenLoading = null;
      return all;
    } catch (e) {
      _lifiTokenLoading = null;
      throw e;
    }
  })();
  return _lifiTokenLoading;
}

/* ─── DEFAULTS ─── */
const DEFAULT_FROM = {
  chain: 'solana', chainId: String(LIFI_SOLANA_CHAIN),
  mint: WSOL_MINT, address: WSOL_MINT,
  symbol: 'SOL', name: 'Solana', decimals: 9,
  logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};
const DEFAULT_TO = {
  chainId: '1',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC', name: 'USD Coin', decimals: 6,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

/* ─── SCROLL LOCK / ESCAPE (same as SwapWidget) ─── */
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

/* ─── TOKEN ICON (same as SwapWidget) ─── */
function TokenIcon({ token, size = 32 }) {
  const [err, setErr] = useState(false);
  if (token?.logoURI && !err)
    return <img src={token.logoURI} alt="" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} onError={() => setErr(true)} />;
  const ch = token?.symbol ? token.symbol.charAt(0).toUpperCase() : '?';
  return <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * .4), fontWeight: 700, color: C.accent }}>{ch}</div>;
}

/* ─── CHAIN BADGE ─── */
function ChainBadge({ chainId, small = false }) {
  const color = chainColor(chainId);
  const name = chainName(chainId);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: color + '22', border: '1px solid ' + color + '55', borderRadius: 6, padding: small ? '2px 6px' : '3px 8px', fontSize: small ? 9 : 10, color, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>
      <div style={{ width: small ? 5 : 6, height: small ? 5 : 6, borderRadius: '50%', background: color }} />
      {name}
    </div>
  );
}

/* ─── STEP PROGRESS ─── */
function StepProgress({ step }) {
  // 0=idle 1=quoting 2=signing 3=bridging 4=done -1=error
  const steps = [
    { label: 'Quote', id: 1 },
    { label: 'Sign',  id: 2 },
    { label: 'Bridge',id: 3 },
    { label: 'Done',  id: 4 },
  ];
  if (step <= 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '14px 0 10px' }}>
      {steps.map((s, i) => {
        const done = step > s.id; const active = step === s.id;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, fontFamily: 'Syne, sans-serif', background: done ? C.green : active ? C.accent : C.card3, color: (done || active) ? '#000' : C.muted, border: active ? '2px solid ' + C.accent : done ? '2px solid ' + C.green : '2px solid ' + C.muted2, boxShadow: active ? '0 0 12px ' + C.accent + '66' : done ? '0 0 8px ' + C.green + '44' : 'none', transition: 'all .3s' }}>
                {done ? '✓' : s.id}
              </div>
              <div style={{ fontSize: 9, color: done ? C.green : active ? C.accent : C.muted, marginTop: 3, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>{s.label}</div>
            </div>
            {i < steps.length - 1 && <div style={{ height: 2, flex: 1, background: done ? C.green : C.muted2, marginBottom: 14, transition: 'background .3s' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── FROM TOKEN MODAL (Solana, OKX list) ─── */
function FromTokenModal({ open, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadOkxSolTokens().then(() => setLoading(false)).catch(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    if (!t) { setResults([]); return; }
    const timer = setTimeout(() => {
      setResults((_okxCache || []).filter(tk =>
        tk.symbol?.toLowerCase().includes(t) ||
        tk.name?.toLowerCase().includes(t) ||
        tk.mint?.toLowerCase().includes(t)
      ).slice(0, 40));
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  const close = useCallback(() => { setQ(''); setResults([]); onClose(); }, [onClose]);
  useBodyScrollLock(open); useEscapeKey(open, close);

  const popular = [DEFAULT_FROM, {
    chain: 'solana', chainId: String(LIFI_SOLANA_CHAIN),
    mint: USDC_SOLANA, address: USDC_SOLANA,
    symbol: 'USDC', name: 'USD Coin', decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  }];
  const display = q.trim() ? results : popular;

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }} />
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
              <ChainBadge chainId={String(LIFI_SOLANA_CHAIN)} small />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ─── TO TOKEN MODAL (all chains, Li.Fi) ─── */
function ToTokenModal({ open, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [allTokens, setAllTokens] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selChain, setSelChain] = useState('all');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadLifiTokens().then(t => { setAllTokens(t); setLoading(false); }).catch(() => setLoading(false));
  }, [open]);

  const chains = useMemo(() => {
    const ids = new Set(allTokens.map(t => t.chainId));
    const order = ['1', '56', '137', '42161', '10', '43114', '8453', '324', '59144', '100'];
    return ['all', ...Array.from(ids).sort((a, b) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.localeCompare(b);
    })];
  }, [allTokens]);

  useEffect(() => {
    const t = q.trim().toLowerCase();
    const filtered = selChain === 'all' ? allTokens : allTokens.filter(tk => tk.chainId === selChain);
    if (!t) {
      setResults(filtered.filter(tk => ['USDC', 'USDT', 'ETH', 'BNB', 'MATIC', 'AVAX', 'WETH', 'DAI'].includes(tk.symbol?.toUpperCase())).slice(0, 24));
      return;
    }
    const timer = setTimeout(() => {
      setResults(filtered.filter(tk =>
        tk.symbol?.toLowerCase().includes(t) ||
        tk.name?.toLowerCase().includes(t) ||
        tk.address?.toLowerCase().includes(t)
      ).slice(0, 50));
    }, 150);
    return () => clearTimeout(timer);
  }, [q, allTokens, selChain]);

  const close = useCallback(() => { setQ(''); setResults([]); setSelChain('all'); onClose(); }, [onClose]);
  useBodyScrollLock(open); useEscapeKey(open, close);

  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,.78)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: C.card, border: '1px solid ' + C.borderHi, borderRadius: 18, width: '94vw', maxWidth: 460, maxHeight: 'min(88vh,100dvh)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Syne, sans-serif' }}>To Token <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>· All Chains</span></div>
            <button onClick={close} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, symbol, or address..." style={{ width: '100%', background: C.card2, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'Syne, sans-serif', marginBottom: 10, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {chains.map(id => {
              const active = selChain === id; const color = id === 'all' ? C.accent : chainColor(id);
              return (
                <button key={id} onClick={() => setSelChain(id)} style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, border: active ? '1px solid ' + color : '1px solid ' + C.muted2, background: active ? color + '22' : 'transparent', color: active ? color : C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
                  {id === 'all' ? 'All' : chainName(id)}
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
              <ChainBadge chainId={t.chainId} small />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
export default function CrossChainSwap({ onConnectWallet }) {
  const { publicKey, connected, wallet: solWallet } = useWallet();
  const { connection } = useConnection();
  useNexusWallet(); // keep context alive

  const pubkey = publicKey || null;
  const wcon = !!connected && !!pubkey;

  /* ── Set Li.Fi Solana provider whenever wallet changes (same as PerpsLanding) ── */
  useEffect(() => {
    ensureLifiConfig();
    if (!solWallet?.adapter) return;
    try {
      lifiConfig.setProviders([
        LifiSolana({ async getWalletAdapter() { return solWallet.adapter; } }),
      ]);
    } catch (e) { console.warn('[lifi setProviders]', e); }
  }, [solWallet?.adapter]);

  /* ── Token state ── */
  const [fromToken, setFromToken] = useState(DEFAULT_FROM);
  const [toToken, setToToken]     = useState(DEFAULT_TO);
  const [fromAmt, setFromAmt]     = useState('');

  /* ── Destination address ── */
  const needsDest = toToken && String(toToken.chainId) !== String(LIFI_SOLANA_CHAIN);
  const [destAddr, setDestAddr]   = useState('');
  const [addrErr, setAddrErr]     = useState('');

  /* ── Quote ── */
  const [route, setRoute]         = useState(null);  // the full Li.Fi route object
  const [quoteDisplay, setQuoteDisplay] = useState(null); // { outDisplay, outAmt, estimatedTime }
  const [quoting, setQuoting]     = useState(false);

  /* ── Execution ── */
  // 0=idle 1=quoting 2=signing/executing 3=bridging 4=done -1=error
  const [step, setStep]           = useState(0);
  const [swapErr, setSwapErr]     = useState('');
  const [txHash, setTxHash]       = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  /* ── Balance (same as SwapWidget) ── */
  const [sbl, setSbl]             = useState(null);
  const [ssb, setSsb]             = useState(null);

  /* ── Modals ── */
  const [fromOpen, setFromOpen]   = useState(false);
  const [toOpen, setToOpen]       = useState(false);

  /* ── Prices ── */
  const [fp, setFp] = useState(null);
  const [tp, setTp] = useState(null);

  /* ── Init ── */
  useEffect(() => {
    ensureLifiConfig();
    loadOkxSolTokens().catch(() => {});
    loadLifiTokens().catch(() => {});
  }, []);

  /* ── Balance fetch (same as SwapWidget) ── */
  useEffect(() => {
    if (!pubkey || !connection) { setSbl(null); setSsb(null); return; }
    let c = false;
    connection.getBalance(pubkey).then(b => { if (!c) setSbl(b); }).catch(() => {});
    if (fromToken?.mint && fromToken.mint !== WSOL_MINT) {
      connection.getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(fromToken.mint) })
        .then(a => { if (!c) setSsb(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0); })
        .catch(() => {});
    } else { setSsb(null); }
    return () => { c = true; };
  }, [pubkey, connection, fromToken]);

  /* ── Balance refresh after success ── */
  useEffect(() => {
    if (step !== 4) return;
    if (pubkey && connection) {
      connection.getBalance(pubkey).then(setSbl).catch(() => {});
      if (fromToken?.mint && fromToken.mint !== WSOL_MINT)
        connection.getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(fromToken.mint) })
          .then(a => setSsb(a.value.length ? a.value[0].account.data.parsed.info.tokenAmount.uiAmount : 0))
          .catch(() => {});
    }
  }, [step, pubkey, connection, fromToken]);

  /* ── displayBalance (same as SwapWidget) ── */
  const fbd = useMemo(() => {
    if (fromToken?.mint === WSOL_MINT) return sbl != null ? sbl / LAMPORTS_PER_SOL : null;
    return ssb;
  }, [fromToken, sbl, ssb]);

  /* ── Prices ── */
  useEffect(() => { let c = false; fetchOkxPrice(fromToken).then(p => { if (!c) setFp(p); }); return () => { c = true; }; }, [fromToken]);
  useEffect(() => { let c = false; fetchOkxPrice(toToken).then(p => { if (!c) setTp(p); }); return () => { c = true; }; }, [toToken]);

  /* ── Dest address validation ── */
  useEffect(() => {
    if (!needsDest || !destAddr.trim()) { setAddrErr(''); return; }
    setAddrErr(validateDestAddress(destAddr, toToken?.chainId) || '');
  }, [destAddr, toToken, needsDest]);

  /* ── Quote fetch — 250ms debounce, uses lifiGetRoutes (same SDK as PerpsLanding) ── */
  const fetchQuote = useCallback(async () => {
    if (!fromAmt || parseFloat(fromAmt) <= 0) { setRoute(null); setQuoteDisplay(null); return; }
    if (!fromToken || !toToken) { setRoute(null); setQuoteDisplay(null); return; }
    setQuoting(true);
    try {
      const dec = getResolvedDecimals(fromToken);
      const raw = toRawAmount(fromAmt, dec);
      if (!raw || raw === '0') { setRoute(null); setQuoteDisplay(null); setQuoting(false); return; }

      const fromAddress = pubkey?.toString();
      const toAddress   = destAddr.trim() || fromAddress;

      const result = await lifiGetRoutes({
        fromChainId:      LIFI_SOLANA_CHAIN,
        toChainId:        Number(toToken.chainId),
        fromTokenAddress: fromToken.mint || fromToken.address,
        toTokenAddress:   toToken.address,
        fromAmount:       raw,
        ...(fromAddress ? { fromAddress, toAddress: toAddress || fromAddress } : {}),
        options: {
          slippage: 0.05,
          order: 'RECOMMENDED',
          allowSwitchChain: false,
        },
      });

      if (!result?.routes?.length) {
        setRoute(null); setQuoteDisplay(null);
        return;
      }

      const best = result.routes[0];
      const toDec = Number(toToken.decimals) || 18;
      const rawOut = best.toAmountMin || best.toAmount;
      const outAmt = rawOut ? Number(rawOut) / Math.pow(10, toDec) : null;
      const estTime = best.steps?.reduce((acc, s) => acc + (s.estimate?.executionDuration || 0), 0) || null;

      setRoute(best);
      setQuoteDisplay({
        outAmt,
        outDisplay: outAmt != null ? fmtTokenDisplay(outAmt) : '~',
        estimatedTime: estTime,
      });
    } catch (e) {
      console.warn('[CrossChain] quote:', e.message);
      setRoute(null); setQuoteDisplay(null);
    } finally { setQuoting(false); }
  }, [fromAmt, fromToken, toToken, destAddr, pubkey]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  /* ── MAX (same as SwapWidget) ── */
  const onMax = useCallback(() => {
    if (fbd == null || fbd <= 0) return;
    const dec = Math.min(getResolvedDecimals(fromToken) ?? 6, 9);
    if (fromToken?.mint === WSOL_MINT) { setFromAmt(fmtInputAmount(maxSafeSolBalance(sbl), dec)); return; }
    setFromAmt(fmtInputAmount(fbd, dec));
  }, [fbd, fromToken, sbl]);

  /* ── Execute — uses lifiExecuteRoute same as PerpsLanding ── */
  const execute = useCallback(async () => {
    if (!wcon) { onConnectWallet?.(); return; }
    if (needsDest) {
      const e = validateDestAddress(destAddr, toToken?.chainId);
      if (e) { setAddrErr(e); return; }
    }

    setStep(1); setSwapErr(''); setTxHash(null); setStatusMsg('Finding best route…');

    try {
      const dec = getResolvedDecimals(fromToken);
      const raw = toRawAmount(fromAmt, dec);
      if (!raw || raw === '0') throw new Error('Invalid amount');
      if (!pubkey) throw new Error('Connect Solana wallet');
      if (!solWallet?.adapter) throw new Error('Wallet adapter not ready');

      ensureLifiConfig();
      lifiConfig.setProviders([
        LifiSolana({ async getWalletAdapter() { return solWallet.adapter; } }),
      ]);

      const fromAddress = pubkey.toString();
      const toAddress   = (needsDest ? destAddr.trim() : fromAddress) || fromAddress;

      // Fetch fresh route for execution (quote may be stale)
      const result = await lifiGetRoutes({
        fromChainId:      LIFI_SOLANA_CHAIN,
        toChainId:        Number(toToken.chainId),
        fromTokenAddress: fromToken.mint || fromToken.address,
        toTokenAddress:   toToken.address,
        fromAmount:       raw,
        fromAddress,
        toAddress,
        options: {
          slippage: 0.05,
          order: 'RECOMMENDED',
          allowSwitchChain: false,
        },
      });

      if (!result?.routes?.length) throw new Error('No route found. Try a larger amount or different token.');

      setStep(2);
      setStatusMsg('Sign in wallet…');

      const executed = await lifiExecuteRoute(result.routes[0], {
        updateRouteHook(updated) {
          const steps = updated?.steps || [];
          const lastStep = steps[steps.length - 1];
          const procs = lastStep?.execution?.process || [];
          const active = procs.find(p => p.status === 'PENDING' || p.status === 'STARTED');
          if (active?.message) {
            setStatusMsg(active.message);
            // Move to bridging step once we have a tx hash
            if (active.txHash && step < 3) setStep(3);
          } else if (procs.some(p => p.status === 'DONE' && p.txHash)) {
            setStep(3);
            setStatusMsg('Bridging…');
          }
        },
      });

      // Extract tx hash from executed route
      let hash = null;
      for (const s of (executed?.steps || []))
        for (const p of (s?.execution?.process || []))
          if (p.txHash) hash = p.txHash;

      if (hash) setTxHash(hash);
      setStep(4);
      setStatusMsg('');

    } catch (e) {
      console.error('[CrossChain] execute:', e);
      setSwapErr(e.message || 'Swap failed');
      setStep(-1);
      setTimeout(() => { setStep(0); setSwapErr(''); }, 5000);
    }
  }, [wcon, needsDest, destAddr, toToken, fromToken, fromAmt, pubkey, solWallet, step, onConnectWallet]);

  const reset = useCallback(() => {
    setStep(0); setSwapErr(''); setTxHash(null); setStatusMsg('');
    setFromAmt(''); setRoute(null); setQuoteDisplay(null);
  }, []);

  /* ── Derived UI ── */
  const fuv = fromAmt && fp > 0 ? parseFloat(fromAmt) * fp : 0;
  const tuv = quoteDisplay?.outAmt && tp > 0 ? quoteDisplay.outAmt * tp : 0;
  const busy = step > 0 && step < 4 && step !== -1;
  const isSuccess = step === 4;
  const isError = step === -1;
  const solscanUrl = txHash ? 'https://solscan.io/tx/' + txHash : null;

  const btnLabel = () => {
    if (!wcon) return 'Connect Wallet';
    if (step === 1) return 'Getting Route…';
    if (step === 2) return 'Sign in Wallet…';
    if (step === 3) return 'Bridging…';
    if (isSuccess) return 'Bridge Complete ✓';
    if (isError) return 'Try Again';
    if (!fromAmt) return 'Enter Amount';
    if (needsDest && !destAddr.trim()) return 'Enter Destination Address';
    if (addrErr) return 'Invalid Address';
    return 'Bridge ' + (fromToken?.symbol || '') + ' → ' + (toToken?.symbol || '');
  };
  const btnBg = () => {
    if (isSuccess) return C.successGrad;
    if (isError) return 'rgba(255,59,107,.2)';
    if (!fromAmt || (needsDest && !destAddr.trim()) || addrErr) return C.card2;
    return C.buyGrad;
  };
  const btnColor = () => (!fromAmt || (needsDest && !destAddr.trim()) || addrErr) ? C.muted2 : '#fff';

  /* ── RENDER ── */
  return (
    <div style={{ width: '100%', maxWidth: 540, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, fontFamily: 'Syne, sans-serif' }}>Cross-Chain</h1>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 4, fontFamily: 'Syne, sans-serif' }}>Solana → Any Chain · Powered by Li.Fi · 5% fee</p>
      </div>

      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 20, padding: 20 }}>
        <StepProgress step={step} />

        {/* FROM */}
        <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>YOU SEND</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ChainBadge chainId={String(LIFI_SOLANA_CHAIN)} small />
              {fbd != null && <span style={{ fontSize: 11, color: C.muted, fontFamily: 'Syne, sans-serif' }}>Bal: <span style={{ color: C.text }}>{fmtTokenDisplay(fbd)}</span></span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => !busy && setFromOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card3, border: '1px solid ' + C.border, borderRadius: 12, padding: '9px 12px', cursor: busy ? 'default' : 'pointer', flexShrink: 0, minWidth: 110 }}>
              <TokenIcon token={fromToken} size={22} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>{fromToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <input value={fromAmt} onChange={e => { if (!busy) setFromAmt(e.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" inputMode="decimal" disabled={busy} style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, color: '#fff', textAlign: 'right', outline: 'none', fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.5 : 1 }} />
            {fbd > 0 && !busy && <button onClick={onMax} style={{ background: 'rgba(0,229,255,.12)', border: '1px solid rgba(0,229,255,.25)', borderRadius: 6, padding: '6px 10px', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: 'Syne, sans-serif' }}>MAX</button>}
          </div>
          {fuv > 0 && <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>{fmtUsd(fuv)}</div>}
        </div>

        {/* ARROW */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.card3, border: '1px solid ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontSize: 16 }}>↓</div>
        </div>

        {/* TO */}
        <div style={{ background: C.card2, borderRadius: 14, padding: 16, border: '1px solid ' + C.border }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, fontFamily: 'Syne, sans-serif' }}>YOU RECEIVE (EST.)</span>
            {toToken && <ChainBadge chainId={toToken.chainId} small />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => !busy && setToOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card3, border: '1px solid ' + C.border, borderRadius: 12, padding: '9px 12px', cursor: busy ? 'default' : 'pointer', flexShrink: 0, minWidth: 110 }}>
              <TokenIcon token={toToken} size={22} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>{toToken?.symbol}</span>
              {!busy && <span style={{ color: C.muted, fontSize: 12 }}>▾</span>}
            </button>
            <div style={{ flex: 1, textAlign: 'right', fontSize: 24, color: quoteDisplay ? C.green : C.muted2, fontFamily: 'JetBrains Mono, monospace' }}>
              {quoting ? <span style={{ fontSize: 14, color: C.muted }}>…</span> : (quoteDisplay?.outDisplay || '0')}
            </div>
          </div>
          {tuv > 0 && <div style={{ textAlign: 'right', marginTop: 6, fontSize: 11, color: C.muted }}>{fmtUsd(tuv)}</div>}
          {quoteDisplay?.estimatedTime && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: 'Syne, sans-serif' }}>
              ~{Math.ceil(quoteDisplay.estimatedTime / 60)} min · Li.Fi
            </div>
          )}
        </div>

        {/* DEST ADDRESS */}
        {needsDest && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 6, fontFamily: 'Syne, sans-serif' }}>
              DESTINATION <span style={{ color: chainColor(toToken?.chainId), fontWeight: 400 }}>· {chainName(toToken?.chainId)}</span>
            </div>
            <div style={{ position: 'relative' }}>
              <input value={destAddr} onChange={e => { if (!busy) setDestAddr(e.target.value.trim()); }} placeholder={isEvm(toToken?.chainId) ? '0x...' : 'Solana address'} disabled={busy} style={{ width: '100%', boxSizing: 'border-box', background: C.card2, border: '1px solid ' + (addrErr ? C.red : destAddr && !addrErr ? C.green : C.border), borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'JetBrains Mono, monospace', opacity: busy ? 0.5 : 1 }} />
              {destAddr && !addrErr && <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: C.green, fontSize: 14 }}>✓</div>}
            </div>
            {addrErr && <div style={{ marginTop: 5, fontSize: 11, color: C.red, fontFamily: 'Syne, sans-serif' }}>{addrErr}</div>}
          </div>
        )}

        {/* QUOTE SUMMARY */}
        {quoteDisplay && fromAmt && (
          <div style={{ marginTop: 14, background: '#050912', borderRadius: 12, padding: 14, border: '1px solid ' + C.border }}>
            {[
              ['Service fee', (FEE_PCT * 100) + '% (via Li.Fi)'],
              ['Slippage', '5% (fixed)'],
              ['Est. time', quoteDisplay.estimatedTime ? '~' + Math.ceil(quoteDisplay.estimatedTime / 60) + ' min' : '—'],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
                <span style={{ color: C.muted, fontFamily: 'Syne, sans-serif' }}>{label}</span>
                <span style={{ color: C.text, fontFamily: 'Syne, sans-serif' }}>{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* ERRORS */}
        {swapErr && <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,59,107,.1)', border: '1px solid rgba(255,59,107,.3)', borderRadius: 8, fontSize: 12, color: C.red, fontFamily: 'Syne, sans-serif' }}>{swapErr}</div>}

        {/* STATUS */}
        {statusMsg && busy && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.15)', borderRadius: 8, fontSize: 12, color: C.accent, fontFamily: 'Syne, sans-serif', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(0,229,255,.3)', borderTopColor: C.accent, animation: 'wc-spin 0.8s linear infinite', flexShrink: 0 }} />
            {statusMsg}
          </div>
        )}

        {/* SUCCESS */}
        {isSuccess && (
          <div style={{ marginTop: 10, padding: 14, background: 'rgba(0,255,163,.06)', border: '1px solid rgba(0,255,163,.2)', borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🎉</div>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 14, fontFamily: 'Syne, sans-serif' }}>Bridge Complete!</div>
          </div>
        )}

        {/* BUTTON (same pattern as SwapWidget) */}
        {!isSuccess ? (
          <button onClick={isError ? reset : (!wcon ? () => onConnectWallet?.() : execute)} disabled={busy && !isError} style={{ width: '100%', marginTop: 16, padding: 16, borderRadius: 14, border: 'none', background: btnBg(), color: btnColor(), fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', minHeight: 54, transition: 'all .2s', opacity: busy ? 0.8 : 1 }}>
            {busy && <span style={{ marginRight: 8 }}>⟳</span>}
            {btnLabel()}
          </button>
        ) : (
          <button onClick={reset} style={{ width: '100%', marginTop: 16, padding: 16, borderRadius: 14, border: 'none', background: C.card3, color: C.accent, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, cursor: 'pointer', minHeight: 54 }}>New Swap</button>
        )}

        {txHash && solscanUrl && <a href={solscanUrl} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: C.accent, fontFamily: 'Syne, sans-serif' }}>View on Solscan ↗</a>}
        <p style={{ textAlign: 'center', fontSize: 10, color: C.muted2, marginTop: 14, fontFamily: 'Syne, sans-serif' }}>Non-custodial · Powered by Li.Fi · Solana origin</p>
      </div>

      <FromTokenModal open={fromOpen} onClose={() => setFromOpen(false)} onSelect={t => { setFromToken(t); setRoute(null); setQuoteDisplay(null); }} />
      <ToTokenModal   open={toOpen}   onClose={() => setToOpen(false)}   onSelect={t => { setToToken(t); setRoute(null); setQuoteDisplay(null); setDestAddr(''); setAddrErr(''); }} />
    </div>
  );
}
