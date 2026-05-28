// MemeWonderland.jsx — buy/sell mirrors SwapWidget.jsx exactly.
//
// Flow (identical to SwapWidget):
//   1. Debounced quote via /api/jupiter/build on every amount/mode/mint change.
//      The build response is stored in state and IS what the user sees.
//   2. On confirm, executeSwap consumes the SAME build (no re-fetch).
//   3. Build fee ixs (5%), prepend to Jupiter ixs, compile ONE v0 tx.
//   4. Pre-flight simulate the same bytes — wallet sees full net effect.
//   5. Sign once, broadcast, confirm with polling fallback.

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
import './MemeWonderland.css';

/* ─── CONFIG (mirrors SwapWidget) ──────────────────────────────────── */
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const FEE_WALLET = new PublicKey('Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV');
const FEE_BPS    = 500;  // 5%
const SLIPPAGE_BPS = 500;
const PRIORITY_FEE_MICROLAMPORTS = 50_000;

const RPC_URL =
  process.env.REACT_APP_SOLANA_RPC ||
  (process.env.REACT_APP_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.REACT_APP_HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com');

const POLL_TOKENS  = 10_000;
const POLL_SOL     = 30_000;
const POLL_WHALES  = 20_000;
const QUOTE_LAMPS  = 1_000_000_000;

const FILTERS = [
  { key: 'trending', label: 'Trending', tf: '24h' },
  { key: '1h',       label: '🔥 1H',    tf: '1h'  },
  { key: '6h',       label: '6H',       tf: '6h'  },
  { key: '24h',      label: '24H',      tf: '24h' },
  { key: 'whales',   label: '🐋 WHALES', tf: null },
  { key: 'new',      label: '🆕 New',   tf: null  },
  { key: 'watch',    label: '⭐ Watch', tf: null  },
];

const EMOJI_POOL = ['🐸','🐶','🐕','🐱','😼','🚀','💎','🍭','💨','🎴','🌈','⚡','🔥'];
function emojiFor(sym = '') {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length];
}

/* ─── HELPERS ──────────────────────────────────────────────────────── */
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1)   return n.toFixed(2);
  return n.toPrecision(3);
}
function formatPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '$0';
  if (p >= 1)      return '$' + p.toFixed(4);
  if (p >= 0.01)   return '$' + p.toFixed(5);
  if (p >= 0.0001) return '$' + p.toFixed(6);
  return '$' + p.toExponential(2);
}
function formatPct(p) {
  if (!Number.isFinite(p)) return '0%';
  return (p >= 0 ? '+' : '') + p.toFixed(p < 10 && p > -10 ? 2 : 1) + '%';
}
function ageOf(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const h = ms / 3_600_000;
  if (h < 1)  return Math.max(1, Math.round(ms / 60_000)) + 'M OLD';
  if (h < 24) return Math.round(h) + 'H OLD';
  const d = h / 24;
  if (d < 365) return Math.round(d) + 'D OLD';
  return Math.round(d / 365) + 'Y OLD';
}
function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function normalize(t, i = 0) {
  const change = Number(t?.stats24h?.priceChange ?? t?.priceChange24h ?? 0);
  return {
    mint:      t.id || t.address || t.mint,
    sym:       t.symbol || '???',
    name:      t.name || t.symbol || 'Unknown',
    emoji:     emojiFor(t.symbol || ''),
    icon:      t.icon || t.logoURI || null,
    price:     Number(t.usdPrice ?? t.priceUsd ?? 0),
    change,
    age:       ageOf(t.firstPool?.createdAt || t.createdAt),
    mcap:      Number(t.mcap ?? t.fdv ?? 0),
    volume24h: Number(t?.stats24h?.buyVolume ?? 0) + Number(t?.stats24h?.sellVolume ?? 0),
    holders:   Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    decimals:  Number(t.decimals ?? 6),
    hot:       i < 2 && change > 50,
    fresh:     !!(t.firstPool?.createdAt && (Date.now() - new Date(t.firstPool.createdAt).getTime()) < 24*3600*1000),
  };
}

const deserIx = (ix) => ({
  programId: new PublicKey(ix.programId),
  keys: ix.accounts.map(a => ({
    pubkey:     new PublicKey(a.pubkey),
    isSigner:   a.isSigner,
    isWritable: a.isWritable,
  })),
  data: Buffer.from(ix.data, 'base64'),
});

const friendlyError = (err) => {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('insufficient'))      return 'Insufficient balance for this swap.';
  if (m.includes('slippage'))          return 'Price moved too much. Try again or increase slippage.';
  if (m.includes('blockhash') || m.includes('expired'))
    return 'Transaction expired. Please try again.';
  if (m.includes('user reject') || m.includes('user denied') || m.includes('user cancelled'))
    return 'Transaction cancelled.';
  if (m.includes('simulation failed')) return 'Swap simulation failed — the price may have moved.';
  if (m.includes('account not'))       return 'Token account not ready. Please try again in a moment.';
  if (m.includes('rate'))              return 'Too many requests — please wait a moment.';
  if (m.includes('could not find any route') || m.includes('no route'))
    return 'No route available for this pair.';
  if (m.includes('too large') || m.includes('transaction too large'))
    return 'Route is too complex to fit in one transaction. Try a different amount or token.';
  return err?.message || 'Swap failed. Please try again.';
};

/* ─── COMPONENT ────────────────────────────────────────────────────── */
export default function MemeWonderland() {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const refCode = publicKey ? publicKey.toString().slice(0, 6) : 'guest';

  const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);

  const [activeFilter, setActiveFilter] = useState('trending');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState(0);
  const [whaleEvents, setWhaleEvents] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [detailMint, setDetailMint] = useState(null);
  const [sheetMint,  setSheetMint]  = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null);

  /* Wallet balances (mirrors SwapWidget). */
  const [balances, setBalances] = useState({});
  const refreshBalances = useCallback(async () => {
    if (!wallet.publicKey) { setBalances({}); return; }
    try {
      const owner = wallet.publicKey;
      const [solBal, tokenAccs] = await Promise.all([
        connection.getBalance(owner),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      ]);
      let token22Accs = { value: [] };
      try {
        token22Accs = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
      } catch {}
      const out = {};
      out[SOL_MINT] = { amount: solBal, decimals: 9, uiAmount: solBal / 1e9 };
      const merge = (accs) => {
        for (const acc of accs.value) {
          const info = acc.account.data.parsed?.info;
          if (!info) continue;
          const mint     = info.mint;
          const amount   = info.tokenAmount?.amount;
          const decimals = info.tokenAmount?.decimals;
          const uiAmount = info.tokenAmount?.uiAmount;
          if (!mint || amount == null) continue;
          out[mint] = { amount: Number(amount), decimals, uiAmount };
        }
      };
      merge(tokenAccs);
      merge(token22Accs);
      setBalances(out);
    } catch (e) {
      console.warn('[mw] balances failed', e);
    }
  }, [wallet.publicKey, connection]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  /* ── Token feeds (unchanged) ────────────────────────────────────── */
  useEffect(() => {
    if (activeFilter === 'whales') return;
    let cancelled = false;
    const f = FILTERS.find(x => x.key === activeFilter);
    async function load() {
      try {
        let url;
        if (activeFilter === 'new')        url = '/api/jupiter/tokens/v2/recent?limit=20';
        else if (activeFilter === 'watch') url = '/api/jupiter/tokens/v2/toporganicscore/24h?limit=20';
        else                               url = `/api/jupiter/tokens/v2/toporganicscore/${f.tf}?limit=20`;
        const r = await fetch(url);
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setTokens(list.map(normalize).filter(t => t.mint));
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    }
    setLoading(true);
    load();
    const id = setInterval(load, POLL_TOKENS);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeFilter]);

  useEffect(() => {
    if (activeFilter !== 'whales') return;
    let cancelled = false;
    async function loadWhales() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        const d = await r.json();
        const events = Array.isArray(d?.events) ? d.events : [];
        if (cancelled) return;
        setWhaleEvents(events);
        if (events.length === 0) { setTokens([]); setLoading(false); return; }
        const mints = events.map(e => e.mint).join(',');
        const tr = await fetch(`/api/jupiter/tokens/search?query=${mints}`);
        const td = await tr.json();
        const list = Array.isArray(td) ? td : (td?.data || []);
        const byMint = new Map(list.map(t => [t.id || t.address, t]));
        const merged = events.map(ev => {
          const t = byMint.get(ev.mint);
          if (!t) {
            return {
              mint: ev.mint, sym: ev.symbol || 'TOKEN', name: ev.name || '',
              emoji: emojiFor(ev.symbol || ''), icon: null,
              price: 0, change: 0, mcap: 0, volume24h: 0, holders: 0, liquidity: 0,
              decimals: 6, whaleSol: ev.solAmount, whaleAt: ev.detectedAt,
            };
          }
          const n = normalize(t);
          n.whaleSol = ev.solAmount;
          n.whaleAt  = ev.detectedAt;
          return n;
        });
        setTokens(merged);
        setLoading(false);
      } catch { if (!cancelled) setLoading(false); }
    }
    setLoading(true);
    loadWhales();
    const id = setInterval(loadWhales, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeFilter]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/sol-price');
        const d = await r.json();
        if (!cancelled && d?.price) setSolPrice(d.price);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_SOL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      try {
        const r = await fetch('/api/whale-events?since=' + (48 * 3600 * 1000));
        const d = await r.json();
        if (!cancelled) setWhaleEvents(Array.isArray(d?.events) ? d.events : []);
      } catch {}
    }
    loadCount();
    const id = setInterval(loadCount, POLL_WHALES);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(q)}`);
        const d = await r.json();
        const list = Array.isArray(d) ? d : (d?.data || d?.tokens || []);
        if (!cancelled) {
          setSearchResults(list.map(normalize).filter(x => x.mint));
          setSearching(false);
        }
      } catch { if (!cancelled) { setSearchResults([]); setSearching(false); } }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  const ticker = useMemo(
    () => tokens.slice(0, 8).map(t => [t.sym, formatPct(t.change), t.change >= 0]),
    [tokens]
  );

  const tokenByMint = useCallback(
    m => tokens.find(t => t.mint === m) || (searchResults || []).find(t => t.mint === m),
    [tokens, searchResults]
  );

  const isSearching = searchResults !== null;
  const gridTokens = isSearching ? searchResults : tokens;

  const openDetail = (mint) => setDetailMint(mint);
  const closeDetail = () => setDetailMint(null);
  const openSheet = (mint, m, e) => {
    if (e) e.stopPropagation();
    setSheetMint(mint); setMode(m);
    setAmount('0.50'); setSelectedPreset('0.5');
  };
  const closeSheet = () => setSheetMint(null);
  const handlePreset = (amt) => { setSelectedPreset(amt); setAmount(amt === 'MAX' ? '1.0' : amt); };
  const handleAmount = (v) => { setAmount(v); setSelectedPreset(null); };

  const isWhalesView = activeFilter === 'whales';
  const sectionTitle = isWhalesView ? 'WHALE ENTRIES · 48H'
    : activeFilter === 'new'   ? 'FRESH LAUNCHES'
    : activeFilter === 'watch' ? 'WATCHLIST'
    : 'HOT RIGHT NOW';

  return (
    <div className="mw-root">
      <div className="mw-ambient">
        <span>🐸</span><span>🚀</span><span>💎</span><span>🍭</span>
      </div>

      <div className="mw-phone">
        <div className="mw-hero">
          <span className="mw-live-tag">LIVE MEME MARKET</span>
          <h1>Meme <span className="mw-wonder">wonderland</span></h1>
          <p>Solana memes, routed through Jupiter. One tap to ape.</p>
        </div>

        {ticker.length > 0 && (
          <div className="mw-ticker-strip">
            <div className="mw-ticker-track">
              {[...ticker, ...ticker].map(([sym, change, up], i) => (
                <span className="mw-ticker-item" key={i}>
                  <span className="mw-sym">{sym}</span>
                  <span className={up ? 'mw-up' : 'mw-down'}>{change}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mw-search-wrap">
          <div className="mw-search">
            <span>🔍</span>
            <input
              placeholder="Search ticker, name, or paste contract"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="mw-search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        <div className="mw-filters">
          {FILTERS.map(f => {
            const isWhale = f.key === 'whales';
            const count = isWhale ? whaleEvents.length : 0;
            return (
              <div
                key={f.key}
                className={
                  'mw-chip'
                  + (activeFilter === f.key ? ' mw-active' : '')
                  + (isWhale ? ' mw-whale-chip' : '')
                  + (isWhale && count > 0 ? ' mw-whale-live' : '')
                }
                onClick={() => setActiveFilter(f.key)}
              >
                {f.label}
                {isWhale && count > 0 && <span className="mw-whale-count">{count}</span>}
              </div>
            );
          })}
        </div>

        <div className="mw-section-head">
          <div className={'mw-section-title' + (isWhalesView && !isSearching ? ' mw-section-whale' : '')}>
            {isSearching ? 'SEARCH RESULTS' : sectionTitle}
          </div>
          <div className="mw-section-meta">
            {isSearching
              ? (searching ? 'SEARCHING…' : `${gridTokens.length} FOUND`)
              : (loading ? 'LOADING…' : isWhalesView ? `${tokens.length} ENTRIES` : `LIVE · ${tokens.length}`)}
          </div>
        </div>

        <div className="mw-grid">
          {(isSearching ? searching && gridTokens.length === 0 : loading && tokens.length === 0) ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mw-card mw-skeleton" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="mw-card-top">
                  <div className="mw-token-icon mw-skel-circle" />
                  <div className="mw-token-meta">
                    <div className="mw-skel-line mw-skel-w-60" />
                    <div className="mw-skel-line mw-skel-w-40" />
                  </div>
                </div>
                <div className="mw-skel-line mw-skel-w-80 mw-skel-tall" />
              </div>
            ))
          ) : gridTokens.length === 0 ? (
            isSearching ? (
              <div className="mw-empty">No tokens match “{searchQuery.trim()}”. Try a ticker, name, or paste a contract address.</div>
            ) : isWhalesView ? (
              <div className="mw-empty mw-empty-whale">
                <div className="mw-empty-whale-emoji">🐋</div>
                <div className="mw-empty-whale-title">No whales today.</div>
                <div className="mw-empty-whale-sub">
                  We watch every Solana pool 24/7.<br />
                  Whales averaging 4-8 entries per month.
                </div>
              </div>
            ) : (
              <div className="mw-empty">No tokens right now. Try another filter.</div>
            )
          ) : (
            gridTokens.slice(0, 12).map((t, i) => (
              <div
                key={t.mint}
                className={
                  'mw-card'
                  + (t.hot ? ' mw-hot' : '')
                  + (t.fresh ? ' mw-fresh' : '')
                  + (t.whaleSol ? ' mw-whale' : '')
                }
                style={{ animationDelay: `${0.03 + i * 0.04}s` }}
                onClick={() => openDetail(t.mint)}
              >
                {t.whaleSol ? (
                  <div className="mw-whale-badge">🐋 +{t.whaleSol.toLocaleString()} SOL</div>
                ) : t.hot ? (
                  <div className="mw-hot-badge">🔥 HOT</div>
                ) : t.fresh ? (
                  <div className="mw-fresh-badge">🆕 NEW</div>
                ) : null}
                <div className="mw-card-top">
                  <div className="mw-token-icon">
                    {t.icon
                      ? <img src={t.icon} alt={t.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : t.emoji}
                  </div>
                  <div className="mw-token-meta">
                    <div className="mw-token-sym">{t.sym}</div>
                    <div className="mw-token-age">
                      {t.whaleAt ? timeAgo(t.whaleAt).toUpperCase() : (t.age || formatPrice(t.price))}
                    </div>
                  </div>
                </div>
                <div className={'mw-change ' + (t.change < 0 ? 'mw-down' : 'mw-up')}>
                  {formatPct(t.change)}
                  <span className="mw-change-label">24H</span>
                </div>
                <div className="mw-actions">
                  <button className="mw-mini-btn mw-buy"  onClick={(e) => openSheet(t.mint, 'buy', e)}>BUY</button>
                  <button className="mw-mini-btn mw-sell" onClick={(e) => openSheet(t.mint, 'sell', e)}>SELL</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {detailMint && tokenByMint(detailMint) && (
        <DetailView
          token={tokenByMint(detailMint)}
          onClose={closeDetail}
          onTrade={(m) => openSheet(detailMint, m)}
        />
      )}

      {sheetMint && tokenByMint(sheetMint) && (
        <TradeSheet
          token={tokenByMint(sheetMint)}
          solPrice={solPrice}
          mode={mode}
          setMode={setMode}
          amount={amount}
          setAmount={handleAmount}
          selectedPreset={selectedPreset}
          handlePreset={handlePreset}
          onClose={closeSheet}
          wallet={wallet}
          connection={connection}
          balances={balances}
          refreshBalances={refreshBalances}
          onSuccess={(payload) => {
            setSuccess({ mint: sheetMint, ...payload });
            setSheetMint(null);
            setDetailMint(null);
          }}
        />
      )}

      {success && tokenByMint(success.mint) && (
        <SuccessView
          data={success}
          token={tokenByMint(success.mint)}
          refCode={refCode}
          onClose={() => setSuccess(null)}
        />
      )}
    </div>
  );
}

/* ─── DETAIL VIEW (unchanged) ──────────────────────────────────────── */
function DetailView({ token, onClose, onTrade }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="mw-detail mw-show">
      <div className="mw-detail-top">
        <button className="mw-icon-btn" onClick={onClose}>←</button>
        <div className="mw-detail-title">${token.sym} <span className="mw-check-mint">✓</span></div>
        <button className="mw-icon-btn">↗</button>
      </div>

      <div className="mw-detail-hero">
        <div className="mw-detail-emoji">
          {token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}
        </div>
        <div className="mw-detail-info">
          <div className="mw-detail-name">{token.sym}</div>
          <div className="mw-detail-fullname">{token.name} · Solana</div>
          <div className="mw-detail-price-row">
            <div className="mw-detail-price">{formatPrice(token.price)}</div>
          </div>
        </div>
      </div>

      <div className="mw-inline-actions">
        <button className="mw-big-btn mw-buy"  onClick={() => onTrade('buy')}>🚀 BUY</button>
        <button className="mw-big-btn mw-sell" onClick={() => onTrade('sell')}>💸 SELL</button>
      </div>

      {token.whaleSol && (
        <div className="mw-whale-banner">
          <span className="mw-whale-banner-emoji">🐋</span>
          <div>
            <div className="mw-whale-banner-title">WHALE ENTRY · {timeAgo(token.whaleAt)}</div>
            <div className="mw-whale-banner-sub">+{token.whaleSol.toLocaleString()} SOL added to liquidity</div>
          </div>
        </div>
      )}

      <div className="mw-stats-grid">
        <div className="mw-stat mw-mcap">
          <span className="mw-stat-icon">💰</span>
          <div className="mw-stat-label">Market Cap</div>
          <div className="mw-stat-value">${format(token.mcap)}</div>
          <div className="mw-stat-sub">USD</div>
        </div>
        <div className="mw-stat mw-holders">
          <span className="mw-stat-icon">{token.emoji}</span>
          <div className="mw-stat-label">Holders</div>
          <div className="mw-stat-value">{token.holders ? format(token.holders) : '—'}</div>
          <div className="mw-stat-sub">on-chain</div>
        </div>
        <div className="mw-stat mw-volume">
          <span className="mw-stat-icon">⚡</span>
          <div className="mw-stat-label">Volume 24h</div>
          <div className="mw-stat-value">${format(token.volume24h)}</div>
          <div className="mw-stat-sub">all DEXs</div>
        </div>
        <div className="mw-stat mw-liq">
          <span className="mw-stat-icon">💧</span>
          <div className="mw-stat-label">Liquidity</div>
          <div className="mw-stat-value">${format(token.liquidity)}</div>
          <div className="mw-stat-sub">🔒 pooled</div>
        </div>
      </div>

      <div className="mw-contract">
        <div className="mw-contract-info">
          <div className="mw-contract-label">Contract</div>
          <div className="mw-contract-addr">{token.mint.slice(0, 8)}…{token.mint.slice(-6)}</div>
        </div>
        <button className="mw-copy-btn" onClick={() => navigator.clipboard?.writeText(token.mint)}>COPY</button>
      </div>
    </div>
  );
}

/* ─── TRADE SHEET — mirrors SwapWidget exactly ────────────────────── */
function TradeSheet({
  token, solPrice, mode, setMode, amount, setAmount,
  selectedPreset, handlePreset, onClose,
  wallet, connection, balances, refreshBalances, onSuccess,
}) {
  const isSell = mode === 'sell';
  const inputMint  = isSell ? token.mint : SOL_MINT;
  const outputMint = isSell ? SOL_MINT  : token.mint;
  const inputDecimals  = isSell ? (token.decimals ?? 6) : 9;
  const outputDecimals = isSell ? 9 : (token.decimals ?? 6);
  const inputSymbol  = isSell ? token.sym : 'SOL';
  const outputSymbol = isSell ? 'SOL' : token.sym;

  const inputBalance = balances[inputMint];
  const amtNum = parseFloat(amount) || 0;
  const usdValue = (amtNum * (isSell ? (token.price || 0) : (solPrice || 0))).toFixed(2);

  /* rawAmount in smallest units (string), exactly like SwapWidget. */
  const rawAmount = useMemo(() => {
    if (!amount) return '';
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.floor(n * Math.pow(10, inputDecimals)).toString();
  }, [amount, inputDecimals]);

  /* QUOTE state — the build response IS the quote. Same shape as SwapWidget. */
  const [build, setBuild] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const quoteAbortRef = useRef(null);

  /* Debounced quote — mirrors SwapWidget's effect exactly. */
  useEffect(() => {
    if (!rawAmount || inputMint === outputMint) {
      setBuild(null);
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
          setBuild(null);
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
          computeUnitPriceMicroLamports: String(PRIORITY_FEE_MICROLAMPORTS),
        });
        const r = await fetch(`/api/jupiter/build?${params}`, { signal: ac.signal });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Quote failed (${r.status})`);
        }
        const data = await r.json();
        if (!ac.signal.aborted) {
          setBuild(data);
          setQuoteError(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setBuild(null);
          setQuoteError(friendlyError(e));
        }
      } finally {
        if (!ac.signal.aborted) setQuoting(false);
      }
    }, 350);

    return () => { clearTimeout(t); ac.abort(); };
  }, [rawAmount, inputMint, outputMint, wallet.publicKey]);

  const outAmountUi = useMemo(() => {
    if (!build) return null;
    return Number(build.outAmount) / Math.pow(10, outputDecimals);
  }, [build, outputDecimals]);

  const receiveAmount = useMemo(() => {
    if (quoting) return 'Quoting…';
    if (outAmountUi == null) return '—';
    return format(outAmountUi) + ' ' + outputSymbol;
  }, [quoting, outAmountUi, outputSymbol]);

  const rate = useMemo(() => {
    if (!outAmountUi || !amtNum) return null;
    return outAmountUi / amtNum;
  }, [outAmountUi, amtNum]);

  /* Body-scroll lock. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* Swap state. */
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState(null);

  /* SWAP — IDENTICAL to SwapWidget.handleSwap. No re-fetch; uses `build`. */
  const handleSwap = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setSwapError('Please connect a wallet (Phantom, Solflare, Backpack).');
      return;
    }
    if (!build) {
      setSwapError('No quote available — try again.');
      return;
    }

    setSwapping(true);
    setSwapError(null);

    try {
      const dec = inputDecimals;

      // 1) Fee instructions FIRST (5% of input mint).
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

      // 2) Assemble ix list: compute-budget, fee, then Jupiter ixs.
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

      // 3) Resolve ALTs.
      const altKeys = Object.keys(build.addressesByLookupTableAddress || {});
      let alts = [];
      if (altKeys.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(altKeys.map(k => new PublicKey(k)));
        alts = altKeys.map((k, i) => infos[i] ? new AddressLookupTableAccount({
          key:   new PublicKey(k),
          state: AddressLookupTableAccount.deserialize(infos[i].data),
        }) : null).filter(Boolean);
      }

      // 4) Compile v0 tx.
      const latest = await connection.getLatestBlockhash('confirmed');
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: latest.blockhash,
        instructions:    ixs,
      }).compileToV0Message(alts);
      const tx = new VersionedTransaction(message);

      // 5) Pre-flight sim — same bytes the wallet will simulate.
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

      // 6) Sign.
      const signed = await wallet.signTransaction(tx);

      // 7) Broadcast.
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 8) Confirm with polling fallback.
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

      const outUi = Number(build.outAmount) / Math.pow(10, outputDecimals);
      onSuccess({
        signature: sig,
        pending: !confirmed,
        paid: amtNum.toFixed(4) + ' ' + inputSymbol,
        got:  format(outUi) + ' ' + outputSymbol,
        price: token.price,
      });

      if (confirmed) setTimeout(() => refreshBalances(), 2000);
    } catch (e) {
      console.error('[mw swap]', e);
      setSwapError(friendlyError(e));
    } finally {
      setSwapping(false);
    }
  }, [
    wallet, build, inputMint, inputDecimals, outputDecimals,
    inputSymbol, outputSymbol, rawAmount, amtNum, token.price,
    connection, onSuccess, refreshBalances,
  ]);

  /* Funds check — same as SwapWidget. */
  const hasFunds = inputBalance && amtNum > 0 && inputBalance.uiAmount >= amtNum;
  const canSwap  = !!wallet.publicKey && !!build && !quoting && !swapping &&
                   amtNum > 0 && inputMint !== outputMint && hasFunds;

  const setMax = () => {
    if (!inputBalance) return;
    let maxAmt = inputBalance.uiAmount;
    if (inputMint === SOL_MINT) maxAmt = Math.max(0, maxAmt - 0.01);
    setAmount(String(maxAmt));
  };

  const ctaLabel = swapping
    ? (isSell ? 'Dumping…' : 'Aping…')
    : !wallet.publicKey
      ? 'Connect Wallet'
      : amtNum <= 0
        ? 'Enter amount'
        : quoting && !build
          ? 'Getting quote…'
          : !build
            ? 'No route available'
            : !hasFunds
              ? `Insufficient ${inputSymbol}`
              : (isSell ? '💸 DUMP ' + token.sym : '🚀 APE INTO ' + token.sym);

  return (
    <>
      <div className="mw-sheet-backdrop mw-show" onClick={swapping ? undefined : onClose}></div>
      <div className="mw-sheet mw-show">
        <div className="mw-grabber"></div>

        <div className="mw-sheet-token-head">
          <div className="mw-sheet-emoji">
            {token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}
          </div>
          <div className="mw-sheet-token-info">
            <div className="mw-sheet-token-name">{token.sym}</div>
            <div className="mw-sheet-sub">
              {token.age && <span className="mw-age-pill">{token.age}</span>}
            </div>
          </div>
          <button className="mw-icon-btn" onClick={onClose} disabled={swapping}>×</button>
        </div>

        <div className={'mw-tab-switch' + (isSell ? ' mw-sell-mode' : '')}>
          <div className="mw-tab-indicator"></div>
          {['buy', 'sell'].map(m => (
            <div
              key={m}
              className={'mw-tab' + (mode === m ? ' mw-active' : '')}
              onClick={() => !swapping && setMode(m)}
            >
              {m.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="mw-amount-section">
          <div className="mw-amount-label">
            <span>You Pay</span>
            <span className="mw-balance">
              {inputBalance
                ? `Bal: ${format(inputBalance.uiAmount)} · ~$${usdValue}`
                : `~$${usdValue}`}
            </span>
          </div>
          <div className="mw-amount-input-wrap">
            <input
              className="mw-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const parts = v.split('.');
                if (parts.length > 2) return;
                setAmount(v);
              }}
              disabled={swapping}
            />
            <div className="mw-currency">
              <div className="mw-currency-icon"></div>
              {inputSymbol}
            </div>
          </div>

          <div className="mw-presets">
            {['0.1', '0.5', '1', 'MAX'].map(p => (
              <button
                key={p}
                className={'mw-preset' + (selectedPreset === p ? ' mw-selected' : '')}
                onClick={() => p === 'MAX' ? setMax() : handlePreset(p)}
                disabled={swapping}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mw-receive">
          <div>
            <div className="mw-receive-label">You Get</div>
            <div className="mw-receive-amount">{receiveAmount}</div>
          </div>
          <div className="mw-receive-rate">
            Rate<br />
            <b>{rate ? `1 ${inputSymbol} = ${format(rate)} ${outputSymbol}` : '—'}</b>
          </div>
        </div>

        {(swapError || quoteError) && (
          <div style={{
            margin: '0 16px 8px',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(255, 80, 80, 0.12)',
            color: '#ff8080',
            fontSize: 13,
            textAlign: 'center',
          }}>
            {swapError || quoteError}
          </div>
        )}

        <div className="mw-cta-wrap">
          <button
            className={'mw-cta' + (isSell ? ' mw-sell-cta' : '')}
            onClick={handleSwap}
            disabled={!canSwap}
          >
            {ctaLabel}
          </button>
          <div className="mw-trust">
            Powered by <span className="mw-jup-badge"><span className="mw-jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── SUCCESS VIEW ─────────────────────────────────────────────────── */
function SuccessView({ data, token, refCode, onClose }) {
  const [confetti, setConfetti] = useState([]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const emojis = ['🎉','🚀','💎','🐸','✨','🍭','💸','⭐','🌈'];
    setConfetti(Array.from({ length: 36 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 100,
      duration: 3 + Math.random() * 3,
      delay: Math.random() * 1.5,
      size: 16 + Math.random() * 14
    })));
  }, []);

  const shareUrl  = `https://nexus.app/t/${data.mint}?ref=${refCode}`;
  const shareText = `Just aped into $${token.sym} on @nexus 🚀\n\nBag: ${data.got}\nEntry: ${formatPrice(data.price)}`;
  const solscanUrl = data.signature ? `https://solscan.io/tx/${data.signature}` : null;

  return (
    <div className="mw-success-overlay mw-show">
      <div className="mw-confetti-rain">
        {confetti.map(p => (
          <div key={p.id} className="mw-confetti-piece" style={{
            left: p.left + '%',
            animationDuration: p.duration + 's',
            animationDelay: p.delay + 's',
            fontSize: p.size + 'px'
          }}>{p.emoji}</div>
        ))}
      </div>

      <div className="mw-success-top">
        <button className="mw-icon-btn" onClick={onClose}>×</button>
        {solscanUrl && (
          <a className="mw-view-on" href={solscanUrl} target="_blank" rel="noreferrer">
            VIEW ON SOLSCAN ↗
          </a>
        )}
      </div>

      <div className="mw-success">
        <div className="mw-success-emoji">{data.pending ? '⏳' : '🎉'}</div>
        <div className="mw-success-title">{data.pending ? 'CONFIRMING…' : 'YOU APED!'}</div>
        <div className="mw-success-sub">
          {data.pending
            ? 'Submitted — confirming on-chain'
            : `Welcome to the ${token.sym} chat, anon ${token.emoji}`}
        </div>
      </div>

      <div className="mw-flex-card">
        <div className="mw-flex-top">
          <div className="mw-flex-emoji">{token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}</div>
          <div className="mw-flex-token">
            <div className="mw-flex-sym">${token.sym}</div>
            <div className="mw-flex-tag">{token.name}</div>
          </div>
        </div>
        <div className="mw-flex-row"><span className="mw-flex-label">You paid</span><span className="mw-flex-value">{data.paid}</span></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Bag size</span><span className="mw-flex-value mw-big">{data.got}</span></div>
        <div className="mw-flex-divider"></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Entry</span><span className="mw-flex-value" style={{ fontSize: '13px' }}>{formatPrice(data.price)}</span></div>
        <div className="mw-flex-watermark">VIA <b>NEXUS</b></div>
      </div>

      <div className="mw-share-section">
        <div className="mw-share-title">FLEX YOUR BAG 💪</div>
        <div className="mw-share-sub">Earn <b>20%</b> of fees from anyone who apes with your link</div>
        <div className="mw-share-grid">
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#000', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank')}>
            <div className="mw-share-icon">𝕏</div><div className="mw-share-label">Post on X</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#229ED9', '--mw-share-color': '#fff' }}
            onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank')}>
            <div className="mw-share-icon">✈</div><div className="mw-share-label">Telegram</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(77,255,210,0.18)', '--mw-share-color': '#4dffd2' }}
            onClick={() => navigator.clipboard?.writeText(shareUrl)}>
            <div className="mw-share-icon">🔗</div><div className="mw-share-label">Copy Link</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(255,225,77,0.18)', '--mw-share-color': '#ffe14d' }}>
            <div className="mw-share-icon">⬇</div><div className="mw-share-label">Save Card</div>
          </button>
        </div>
      </div>

      <div className="mw-refer">
        <div className="mw-refer-row">
          <div className="mw-refer-emoji">💰</div>
          <div className="mw-refer-text">
            <div className="mw-refer-title">YOUR REFERRAL LINK</div>
            <div className="mw-refer-sub">Earn 20% of every swap fee — forever</div>
          </div>
        </div>
        <div className="mw-refer-link">
          <span className="mw-refer-url">nexus.app/t/{data.mint.slice(0, 6)}…?ref=<b>{refCode}</b></span>
          <button className="mw-refer-copy" onClick={() => navigator.clipboard?.writeText(shareUrl)}>COPY</button>
        </div>
      </div>

      <div className="mw-done-wrap">
        <button className="mw-done-btn" onClick={onClose}>🚀 BACK TO WONDERLAND</button>
      </div>
    </div>
  );
}
