import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useNexusWallet } from '../WalletContext.js';
import { PublicKey } from '@solana/web3.js';

// =====================================================================
// DESIGN TOKENS — match PredictionsTonight/PerpsTrade exactly
// =====================================================================
const C = {
  bg:'#04070f', bg2:'#070b16', surface:'#0a1020', surface2:'#0e1428',
  ink:'#e6efff', inkStr:'#f5fafe',
  muted:'#7a92b3', muted2:'#475670',
  hl:'#97fce4', hl2:'#5ce9c8', hlDim:'rgba(151,252,228,.14)',
  violet:'#a87fff', sol:'#9945ff',
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
// CONSTANTS
// =====================================================================
const SOL_MINT              = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA           = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA           = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SPL_LEGACY_PROGRAM    = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SPL_TOKEN2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// xStocks (tokenized equities, Token-2022). Same 18 mints as Stocks.jsx —
// keeping them here so Portfolio can name + price holdings. isStock + isT22
// flags drive special handling (Jupiter Price V3 routing, stock badge).
const XSTOCKS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol:'TSLAx',  name:'Tesla',                color:'#e31837', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol:'AAPLx',  name:'Apple',                color:'#a2aaad', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol:'NVDAx',  name:'NVIDIA',               color:'#76b900', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { symbol:'METAx',  name:'Meta Platforms',       color:'#0866ff', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { symbol:'GOOGLx', name:'Alphabet',             color:'#4285f4', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { symbol:'AMZNx',  name:'Amazon',               color:'#ff9900', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { symbol:'MSFTx',  name:'Microsoft',            color:'#00a4ef', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { symbol:'NFLXx',  name:'Netflix',              color:'#e50914', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { symbol:'PLTRx',  name:'Palantir',             color:'#404040', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { symbol:'AVGOx',  name:'Broadcom',             color:'#cc092f', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { symbol:'COINx',  name:'Coinbase',             color:'#0052ff', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { symbol:'MSTRx',  name:'MicroStrategy',        color:'#fcb017', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { symbol:'CRCLx',  name:'Circle',               color:'#3399ff', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { symbol:'HOODx',  name:'Robinhood',            color:'#cdff00', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol:'SPYx',   name:'S&P 500 ETF',          color:'#1c4f9c', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol:'QQQx',   name:'Nasdaq 100 ETF',       color:'#003b71', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol:'GLDx',   name:'Gold Trust',           color:'#d4af37', textColor:'#000', isStock:true, isT22:true, decimals:8 },
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { symbol:'TBLLx',  name:'1-3 Month T-Bill ETF', color:'#2a4d6e', textColor:'#fff', isStock:true, isT22:true, decimals:8 },
};

// Known tokens — gives top holdings real names + brand colors.
// xStocks merged in so they render with proper names + colors and pass the
// curated-filter check below. Long tail falls back to first-letter badge.
const KNOWN_TOKENS = {
  [SOL_MINT]:                                       { symbol:'SOL',    name:'Solana',           color:'#9945ff', textColor:'#fff' },
  [USDC_SOLANA]:                                    { symbol:'USDC',   name:'USD Coin',         color:'#2775ca', textColor:'#fff', isStable:true },
  [USDT_SOLANA]:                                    { symbol:'USDT',   name:'Tether USD',       color:'#26a17b', textColor:'#fff', isStable:true },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263':   { symbol:'BONK',   name:'Bonk',             color:'#fcb017', textColor:'#000' },
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL':    { symbol:'JTO',    name:'Jito',             color:'#7dffb5', textColor:'#000' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN':    { symbol:'JUP',    name:'Jupiter',          color:'#c7f284', textColor:'#000' },
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm':   { symbol:'WIF',    name:'dogwifhat',        color:'#ffba00', textColor:'#000' },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr':   { symbol:'POPCAT', name:'Popcat',           color:'#ffd700', textColor:'#000' },
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3':   { symbol:'PYTH',   name:'Pyth Network',     color:'#e6c5ff', textColor:'#000' },
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5':    { symbol:'MEW',    name:'cat in dogs world',color:'#9b4dca', textColor:'#fff' },
  '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ':   { symbol:'W',      name:'Wormhole',         color:'#3b5dab', textColor:'#fff' },
  ...XSTOCKS,
};

// =====================================================================
// UTILS
// =====================================================================
function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  if (n > 0)      return '$' + n.toFixed(6);
  return '$0.00';
}
function fmtTokenAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  if (n > 0)     return n.toFixed(6);
  return '0';
}
function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}
function tokenAmountForOne(decimals) {
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 6;
  return String(Math.round(10 ** Math.min(Math.max(d, 0), 12)));
}
function tokenMeta(mint, fallbackSym) {
  const k = KNOWN_TOKENS[mint];
  if (k) return k;
  return { symbol: fallbackSym || (mint || '').slice(0, 4) + '...', name: 'SPL Token', color: '#97fce4', textColor: '#04070f' };
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

function openTokenPage(token, onSelectCoin) {
  if (!token || !onSelectCoin) return;
  const mint = token.mint || token.address || token.tokenAddress || token.id;
  if (!mint) return;
  onSelectCoin({
    id:           mint,
    mint,
    address:      mint,
    tokenAddress: mint,
    symbol:       token.symbol || mint.slice(0, 4) + '...',
    name:         token.name || token.symbol || mint.slice(0, 4) + '...',
    chain:        'solana',
    decimals:     token.decimals,
    price:        token.price,
    value:        token.value,
    uiAmount:     token.uiAmount,
  });
}

// =====================================================================
// PRICE FETCHING
// Stablecoins shortcut to $1 (OKX can't quote USDC↔USDC). xStocks route
// through Jupiter Price V3 since OKX doesn't have Token-2022 pricing.
// Everything else: OKX first, Jupiter V3 fallback.
// =====================================================================
const _priceCache = {};
function clearPriceCache() { Object.keys(_priceCache).forEach(k => delete _priceCache[k]); }
function readOkxToTokenAmount(data) {
  const d = Array.isArray(data) ? data[0] : data;
  return Number(d?.toTokenAmount || d?.routerResult?.toTokenAmount || d?.quoteCompareList?.[0]?.toTokenAmount || 0);
}
async function fetchJupiterPriceV3(mint) {
  try {
    // V3 was launched Oct 2025 — V2 is deprecated and returns 410. Field
    // renamed from `price` to `usdPrice`, no nested `data` wrapper.
    const r = await fetch(`https://api.jup.ag/price/v3?ids=${mint}`);
    const j = await r.json();
    const price = j?.[mint]?.usdPrice;
    if (price && Number.isFinite(Number(price)) && Number(price) > 0) return Number(price);
  } catch {}
  return 0;
}
async function fetchTokenPriceUsd(mint, decimals = 6, force = false) {
  if (!mint) return 0;
  // Stablecoin shortcut — never call the network for these.
  const meta = KNOWN_TOKENS[mint];
  if (meta?.isStable) return 1;

  const key = `${String(mint).toLowerCase()}:${decimals}`;
  if (!force && _priceCache[key] && Date.now() - _priceCache[key].ts < 60000) return _priceCache[key].price;

  // xStocks (Token-2022) — OKX doesn't price them, go straight to Jupiter V3.
  if (meta?.isT22 || meta?.isStock) {
    const p = await fetchJupiterPriceV3(mint);
    if (p > 0) { _priceCache[key] = { price: p, ts: Date.now() }; return p; }
    return 0;
  }

  // Regular SPL: OKX aggregator quote first (best for liquid SPL tokens).
  try {
    const amount = mint === SOL_MINT ? '1000000000' : tokenAmountForOne(decimals);
    const r = await fetch(`/api/okx/dex/aggregator/quote?chainIndex=501&fromTokenAddress=${mint}&toTokenAddress=${USDC_SOLANA}&amount=${amount}`);
    const j = await r.json();
    if (j.code === '0' && j.data) {
      const toTokenAmount = readOkxToTokenAmount(j.data);
      const price = toTokenAmount / 1e6;
      if (price > 0 && Number.isFinite(price)) {
        _priceCache[key] = { price, ts: Date.now() };
        return price;
      }
    }
  } catch {}
  // Fallback: Jupiter V3 (covers anything OKX missed).
  const jupPrice = await fetchJupiterPriceV3(mint);
  if (jupPrice > 0) { _priceCache[key] = { price: jupPrice, ts: Date.now() }; return jupPrice; }
  return 0;
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function TokenBadge({ mint, fallbackSym, size = 36 }) {
  const meta = tokenMeta(mint, fallbackSym);
  // Stock badges use ticker letters (G for GOOGL) instead of first letter
  // of the xStock symbol (which is also G). Same outcome, clearer intent.
  const letter = (meta.symbol || '?').replace(/x$/, '').charAt(0).toUpperCase() || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${meta.color}, ${meta.color}dd)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: meta.textColor, fontWeight: 900, fontSize: Math.round(size * 0.38),
      flexShrink: 0, letterSpacing: '-.02em',
      boxShadow: `0 4px 12px ${meta.color}40`,
      ...T.display,
    }}>{letter}</div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '36px 1fr 80px', gap: 12, alignItems: 'center', borderBottom: `1px solid ${C.hairline}` }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.04)' }}/>
      <div>
        <div style={{ height: 12, width: 64, borderRadius: 4, background: 'rgba(255,255,255,.05)', marginBottom: 6 }}/>
        <div style={{ height: 10, width: 96, borderRadius: 4, background: 'rgba(255,255,255,.035)' }}/>
      </div>
      <div style={{ height: 12, width: 60, borderRadius: 4, background: 'rgba(255,255,255,.05)', justifySelf: 'end' }}/>
    </div>
  );
}

function TokenRow({ token, onClick }) {
  const meta = tokenMeta(token.mint, token.symbol);
  const val  = token.value || 0;
  const isStock = meta.isStock;
  return (
    <button onClick={onClick} style={{
      padding: '14px 18px', display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 12, alignItems: 'center',
      background: 'transparent',
      border: 'none', borderBottom: `1px solid ${C.hairline}`,
      width: '100%', textAlign: 'left',
      cursor: onClick ? 'pointer' : 'default',
      WebkitTapHighlightColor: 'rgba(151,252,228,.10)',
      transition: 'background .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(151,252,228,.03)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <TokenBadge mint={token.mint} fallbackSym={token.symbol} size={36}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.inkStr, fontWeight: 800, fontSize: 14, letterSpacing: '-.01em', ...T.display }}>{meta.symbol}</span>
          {isStock && (
            <span style={{ color: C.hl, fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: C.hlDim, border: `1px solid ${C.borderHi}`, letterSpacing: '.06em', ...T.mono }}>STOCK</span>
          )}
          <span style={{ color: C.muted, fontSize: 10, fontWeight: 600, ...T.mono }}>
            {token.price > 0 ? fmt(token.price) : '—'}
          </span>
        </div>
        <div style={{ color: C.muted, fontSize: 11, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, ...T.body }}>
          {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {meta.name}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: val > 0 ? C.inkStr : C.muted, fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums', ...T.mono }}>
          {val > 0 ? fmt(val) : '—'}
        </div>
      </div>
    </button>
  );
}

// =====================================================================
// MAIN
// =====================================================================
export default function Portfolio({ onSelectCoin, onConnectWallet }) {
  const { publicKey: extPk, connected: solCon } = useWallet();
  const { connection } = useConnection();
  const { privyEmbeddedSol } = useNexusWallet();

  const pubkey = useMemo(() => {
    if (extPk) return extPk;
    if (privyEmbeddedSol?.address) {
      try { return new PublicKey(privyEmbeddedSol.address); }
      catch { return null; }
    }
    return null;
  }, [extPk, privyEmbeddedSol?.address]);

  const hasSol = !!(solCon || (privyEmbeddedSol && pubkey));

  const [solBalance, setSolBalance]     = useState(0);
  const [solPriceUsd, setSolPriceUsd]   = useState(0);
  const [solBalances, setSolBalances]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState('');
  const [copied, setCopied]             = useState(false);

  const fetchPortfolio = useCallback(async (force = false) => {
    if (!pubkey || !connection) { setLoading(false); return; }
    if (force) clearPriceCache();
    setLoading(true); setRefreshing(true); setError('');

    try {
      const lamports = await connection.getBalance(pubkey);
      setSolBalance(lamports / 1e9);

      const solPrice = await fetchTokenPriceUsd(SOL_MINT, 9, force);
      setSolPriceUsd(solPrice > 0 ? solPrice : 0);

      // Fetch BOTH legacy SPL and Token-2022 accounts. Token-2022 covers
      // xStocks; without this branch the wallet won't list them.
      const results = await Promise.allSettled([
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_LEGACY_PROGRAM }),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN2022_PROGRAM }),
      ]);

      let allAccounts = [];
      results.forEach(r => { if (r.status === 'fulfilled' && r.value?.value) allAccounts = allAccounts.concat(r.value.value); });

      const byMint = {};
      allAccounts.forEach(acc => {
        try {
          const info = acc.account.data.parsed.info;
          const ta   = info.tokenAmount || {};
          const ui   = Number(ta.uiAmountString || ta.uiAmount || 0);
          const mint = info.mint;
          if (!mint || !Number.isFinite(ui) || ui <= 0.000001) return;
          if (!byMint[mint]) byMint[mint] = { mint, uiAmount: 0, decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6 };
          byMint[mint].uiAmount += ui;
        } catch {}
      });

      // Filter to curated known tokens (USDC/USDT/popular SPL/xStocks).
      // Hides airdrop junk / scam tokens automatically.
      const holdings = Object.values(byMint).filter(h => h.mint !== SOL_MINT && KNOWN_TOKENS[h.mint]);
      const priced = [];
      for (const h of holdings) {
        const price = await fetchTokenPriceUsd(h.mint, h.decimals, force);
        const meta = tokenMeta(h.mint);
        priced.push({
          ...h,
          price: price > 0 && Number.isFinite(price) ? price : 0,
          value: h.uiAmount * (price > 0 ? price : 0),
          symbol: meta.symbol,
          name: meta.name,
        });
      }
      // Sort: stablecoins first, then stocks, then by value desc.
      priced.sort((a, b) => {
        const ma = tokenMeta(a.mint), mb = tokenMeta(b.mint);
        const rank = m => m.isStable ? 0 : m.isStock ? 1 : 2;
        const ra = rank(ma), rb = rank(mb);
        if (ra !== rb) return ra - rb;
        return b.value - a.value;
      });
      setSolBalances(priced);
    } catch (e) {
      setError('Failed to load portfolio');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [pubkey, connection]);

  useEffect(() => {
    if (!pubkey || !connection) { setLoading(false); return undefined; }
    fetchPortfolio(false);
    const i = setInterval(() => fetchPortfolio(false), 30000);
    return () => clearInterval(i);
  }, [pubkey, connection, fetchPortfolio]);

  const handleRefresh    = useCallback(() => fetchPortfolio(true), [fetchPortfolio]);
  const displayAddr      = pubkey ? pubkey.toString() : null;
  const handleCopyAddr   = useCallback(async () => {
    if (!displayAddr) return;
    const ok = await copyText(displayAddr);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  }, [displayAddr]);

  const solValue    = solBalance * solPriceUsd;
  const tokensTotal = solBalances.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue  = solValue + tokensTotal;
  const tokenCount  = solBalances.length + (solBalance > 0 ? 1 : 0);
  const stockCount  = solBalances.filter(h => KNOWN_TOKENS[h.mint]?.isStock).length;

  // ===================================================================
  // DISCONNECTED STATE
  // ===================================================================
  if (!hasSol) {
    return (
      <>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap');`}</style>
        <div style={{ maxWidth: 520, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>
          <div style={{ textAlign: 'center', padding: '60px 24px 40px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, marginTop: 24 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: C.glow }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#04070f" strokeWidth="2.5">
                <rect x="2" y="6" width="20" height="14" rx="2"/>
                <path d="M2 12h20"/>
              </svg>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: C.inkStr, margin: '0 0 8px', letterSpacing: '-.04em', ...T.hero }}>
              Connect your{' '}
              <span style={{ fontStyle: 'italic', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>wallet</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 13, margin: '0 0 28px', lineHeight: 1.5, ...T.body }}>
              See your SOL balance, token holdings, and live valuations powered by OKX + Jupiter price feeds.
            </p>
            <button onClick={() => onConnectWallet?.()} style={{
              background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, border: 'none', borderRadius: 14,
              padding: '14px 32px', color: '#04070f', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', boxShadow: C.glow, letterSpacing: '-.01em', ...T.display,
            }}>Connect Wallet</button>
          </div>
        </div>
      </>
    );
  }

  // ===================================================================
  // CONNECTED STATE
  // ===================================================================
  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Mono:wght@500;600;700&display=swap'); @import url('https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap'); @keyframes nx-spin { to{transform:rotate(360deg)} }`}</style>

      <div style={{ maxWidth: 600, margin: '0 auto', width: '100%', padding: '0 16px calc(env(safe-area-inset-bottom) + 90px)', color: C.ink, backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%,rgba(151,252,228,.10),transparent 60%),radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%)' }}>

        {/* HERO */}
        <div style={{ marginTop: 10, padding: '24px 22px 22px', borderRadius: 26, background: 'linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98))', border: '1px solid rgba(255,255,255,.07)', boxShadow: C.shadowLg, position: 'relative', overflow: 'hidden' }}>
          {/* Radial overlay */}
          <div style={{ position: 'absolute', right: -50, top: -60, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(168,127,255,.16),transparent 65%)', pointerEvents: 'none' }}/>
          <div style={{ position: 'absolute', left: -80, bottom: -80, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(151,252,228,.10),transparent 65%)', pointerEvents: 'none' }}/>

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.up, boxShadow: `0 0 8px ${C.up}` }}/>
                <span style={{ color: C.up, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>SOLANA · LIVE</span>
              </div>
              <button onClick={handleRefresh} disabled={refreshing} style={{
                background: 'rgba(151,252,228,.06)', border: `1px solid ${C.borderHi}`,
                borderRadius: 999, width: 32, height: 32, padding: 0,
                cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: C.hl,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={refreshing ? { animation: 'nx-spin 1s linear infinite' } : null}>
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
            </div>

            <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.12em', marginBottom: 4, ...T.mono }}>PORTFOLIO VALUE</div>
            <div style={{ fontSize: 44, fontWeight: 500, color: C.inkStr, letterSpacing: '-.04em', lineHeight: 1.0, marginBottom: 14, fontVariantNumeric: 'tabular-nums', ...T.hero }}>
              {fmt(totalValue)}
            </div>

            {/* Address pill — tap to copy */}
            <button onClick={handleCopyAddr} style={{
              background: 'rgba(0,0,0,.30)', border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '9px 13px', cursor: 'pointer', width: '100%',
              display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHi}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: `linear-gradient(135deg,${C.sol},#7c3aed)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 2px 8px ${C.sol}40` }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', ...T.display }}>S</span>
              </div>
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>WALLET ADDRESS</div>
                <div style={{ fontSize: 12, color: C.ink, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...T.mono }}>{shortAddr(displayAddr)}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: copied ? C.up : C.hl, padding: '4px 9px', borderRadius: 8, background: copied ? 'rgba(61,213,152,.10)' : C.hlDim, border: `1px solid ${copied ? 'rgba(61,213,152,.30)' : C.borderHi}`, letterSpacing: '.06em', flexShrink: 0, ...T.mono }}>
                {copied ? 'COPIED' : 'COPY'}
              </span>
            </button>
          </div>
        </div>

        {/* QUICK STATS STRIP */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12, marginBottom: 18 }}>
          {[
            { label: 'SOL',        value: solBalance.toFixed(3),       sub: solValue > 0 ? fmt(solValue) : '—', color: C.sol },
            { label: 'HOLDINGS',   value: String(tokenCount),          sub: tokenCount === 1 ? 'asset' : 'assets', color: C.hl },
            { label: 'STOCKS',     value: String(stockCount),          sub: stockCount === 1 ? 'xStock' : 'xStocks', color: C.violet },
          ].map(s => (
            <div key={s.label} style={{ padding: '10px 12px', borderRadius: 14, background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, backdropFilter: 'blur(12px)' }}>
              <div style={{ fontSize: 8, color: C.muted2, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>{s.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: s.color, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: 'tabular-nums', ...T.display }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 2, fontWeight: 600, ...T.mono }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ERROR */}
        {error && (
          <div style={{ background: 'rgba(255,138,158,.08)', border: '1px solid rgba(255,138,158,.24)', borderRadius: 12, padding: 12, marginBottom: 14, fontSize: 12, color: C.down, ...T.body }}>
            {error}
          </div>
        )}

        {/* HOLDINGS HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.12em', ...T.mono }}>HOLDINGS</div>
          <div style={{ fontSize: 9, color: C.muted2, fontWeight: 600, ...T.mono }}>OKX + JUPITER · AUTO 30s</div>
        </div>

        {/* HOLDINGS LIST */}
        <div style={{ background: 'rgba(10,16,32,.50)', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', backdropFilter: 'blur(12px)' }}>

          {/* SOL row — always shown if connected. Not clickable: this is a
              read-only wallet view; trading happens on Swap / Stocks tabs. */}
          <TokenRow
            token={{ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, price: solPriceUsd, value: solValue, uiAmount: solBalance }}
          />

          {/* SPL + Token-2022 tokens (USDC, USDT, xStocks, etc.) */}
          {loading && !solBalances.length ? (
            <>
              <SkeletonRow/>
              <SkeletonRow/>
              <SkeletonRow/>
            </>
          ) : !solBalances.length ? (
            <div style={{ padding: '28px 18px', textAlign: 'center' }}>
              <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 6, fontWeight: 600, ...T.body }}>No tokens yet.</div>
              <div style={{ color: C.muted2, fontSize: 11, ...T.body }}>Buy something on the Swap or Stocks tab to get started.</div>
            </div>
          ) : solBalances.map(token => (
            <TokenRow
              key={token.mint}
              token={token}
            />
          ))}
        </div>

        {/* FOOTER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '14px 16px', marginTop: 18, borderRadius: 14, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POWERED BY</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', background: `linear-gradient(135deg,${C.hl} 0%,${C.violet} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', ...T.mono }}>OKX + JUPITER</span>
          <span style={{ color: C.muted2, fontSize: 9 }}>|</span>
          <span style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>NON-CUSTODIAL</span>
        </div>
      </div>
    </>
  );
}
