import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import './MemeWonderland.css';

const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const POLL_TOKENS  = 10_000;
const POLL_SOL     = 30_000;
const POLL_WHALES  = 20_000;
const QUOTE_LAMPS  = 1_000_000_000;

// Known stablecoin mints — pressure bar is meaningless here (pegged price, bot/arb only)
const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
  'CASHVDm2wsJXfhj6VWxb7GiMdoLc17Du7paH4bNr5woT', // CASH (Solana)
]);

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
function shortAddr(a) {
  if (!a) return 'Connect';
  const s = a.toString();
  return s.slice(0, 4) + '...' + s.slice(-4);
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
    buyVol24h: Number(t?.stats24h?.buyVolume  ?? 0),
    sellVol24h:Number(t?.stats24h?.sellVolume ?? 0),
    holders:   Number(t.holderCount || 0),
    liquidity: Number(t.liquidity || 0),
    hot:       i < 2 && change > 50,
    fresh:     !!(t.firstPool?.createdAt && (Date.now() - new Date(t.firstPool.createdAt).getTime()) < 24*3600*1000),
  };
}

export default function MemeWonderland() {
  const { publicKey } = useWallet();
  const refCode = publicKey ? publicKey.toString().slice(0, 6) : 'guest';

  const [activeFilter, setActiveFilter] = useState('trending');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [solPrice, setSolPrice] = useState(0);
  const [whaleEvents, setWhaleEvents] = useState([]);

  const [detailMint, setDetailMint] = useState(null);
  const [sheetMint,  setSheetMint]  = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null);
  const [feedTab, setFeedTab] = useState('LIVE TRADES');

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
      } catch {
        if (!cancelled) setLoading(false);
      }
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

        if (events.length === 0) {
          setTokens([]);
          setLoading(false);
          return;
        }
        const mints = events.map(e => e.mint).join(',');
        const tr = await fetch(`/api/jupiter/tokens/search?query=${mints}`);
        const td = await tr.json();
        const list = Array.isArray(td) ? td : (td?.data || []);
        const byMint = new Map(list.map(t => [t.id || t.address, t]));
        const merged = events.map(ev => {
          const t = byMint.get(ev.mint);
          if (!t) {
            return {
              mint:     ev.mint,
              sym:      ev.symbol || 'TOKEN',
              name:     ev.name   || '',
              emoji:    emojiFor(ev.symbol || ''),
              icon:     null,
              price:    0,
              change:   0,
              mcap:     0,
              volume24h:0, buyVol24h:0, sellVol24h:0,
              holders:  0, liquidity: 0,
              whaleSol: ev.solAmount,
              whaleAt:  ev.detectedAt,
            };
          }
          const n = normalize(t);
          n.whaleSol = ev.solAmount;
          n.whaleAt  = ev.detectedAt;
          return n;
        });
        setTokens(merged);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
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

  const ticker = useMemo(() => {
    return tokens.slice(0, 8).map(t => [t.sym, formatPct(t.change), t.change >= 0]);
  }, [tokens]);

  const tokenByMint = useCallback(m => tokens.find(t => t.mint === m), [tokens]);

  const openDetail = (mint) => { setDetailMint(mint); };
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
        {/* NOTE: duplicate NEXUS DEX header removed — parent app provides it. */}

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
            <input placeholder="Search ticker, name, or paste contract" />
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
          <div className={'mw-section-title' + (isWhalesView ? ' mw-section-whale' : '')}>
            {sectionTitle}
          </div>
          <div className="mw-section-meta">
            {loading ? 'LOADING…' : isWhalesView ? `${tokens.length} ENTRIES` : `LIVE · ${tokens.length}`}
          </div>
        </div>

        <div className="mw-grid">
          {loading && tokens.length === 0 ? (
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
          ) : tokens.length === 0 ? (
            isWhalesView ? (
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
            tokens.slice(0, 12).map((t, i) => (
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
          feedTab={feedTab}
          setFeedTab={setFeedTab}
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
          onConfirm={(paid, got) => {
            setSuccess({ mint: sheetMint, paid, got, price: tokenByMint(sheetMint).price });
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

function DetailView({ token, feedTab, setFeedTab, onClose, onTrade }) {
  const isDown = token.change < 0;
  const isStable = STABLE_MINTS.has(token.mint);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const totalVol = token.buyVol24h + token.sellVol24h;
  const buyPct   = totalVol > 0 ? (token.buyVol24h / totalVol) * 100 : 50;
  const sellPct  = 100 - buyPct;
  const buyHeavy = buyPct >= 50;

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
            <span className={'mw-change-pill' + (isDown ? ' mw-down-pill' : '')}>
              {isDown ? '📉 ' : '📈 '}{formatPct(token.change)}
            </span>
          </div>
        </div>
      </div>

      <div className="mw-inline-actions">
        <button className="mw-big-btn mw-buy"  onClick={() => onTrade('buy')}>🚀 BUY</button>
        <button className="mw-big-btn mw-sell" onClick={() => onTrade('sell')}>💸 SELL</button>
      </div>

      {/* Pressure bar — hidden for stablecoins (bot/arb noise, not real signal) */}
      {!isStable && (
        <div className="mw-pressure-wrap">
          <div className="mw-pressure-head">
            <span className="mw-pressure-label">⚡ BUY / SELL PRESSURE · 24H</span>
            <span className={'mw-pressure-verdict ' + (buyHeavy ? 'mw-up' : 'mw-down')}>
              {buyHeavy ? 'BULLS WINNING' : 'BEARS WINNING'}
            </span>
          </div>
          <div className="mw-pressure-bar">
            <div className="mw-pressure-buy"  style={{ width: buyPct  + '%' }}>
              {buyPct >= 18 && <span>{buyPct.toFixed(0)}% BUYS</span>}
            </div>
            <div className="mw-pressure-sell" style={{ width: sellPct + '%' }}>
              {sellPct >= 18 && <span>{sellPct.toFixed(0)}% SELLS</span>}
            </div>
          </div>
          <div className="mw-pressure-totals">
            <span><b className="mw-up">${format(token.buyVol24h)}</b> bought</span>
            <span><b className="mw-down">${format(token.sellVol24h)}</b> sold</span>
          </div>
        </div>
      )}

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
          <div className={'mw-stat-sub ' + (isDown ? 'mw-down' : 'mw-up')}>{formatPct(token.change)} 24h</div>
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

      <div className="mw-feed">
        <div className="mw-feed-tabs">
          {['LIVE TRADES', 'TOP HOLDERS'].map(ft => (
            <div key={ft} className={'mw-feed-tab' + (feedTab === ft ? ' mw-active' : '')} onClick={() => setFeedTab(ft)}>
              {ft}
            </div>
          ))}
        </div>
        <div className="mw-feed-list">
          <div className="mw-feed-empty">Live trade feed coming soon</div>
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

function TradeSheet({ token, solPrice, mode, setMode, amount, setAmount, selectedPreset, handlePreset, onClose, onConfirm }) {
  const isDown = token.change < 0;
  const amtNum = parseFloat(amount) || 0;
  const usdValue = (amtNum * (solPrice || 0)).toFixed(2);
  const [tps, setTps] = useState(0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function quote() {
      try {
        const r = await fetch(`/api/jupiter/quote?inputMint=${SOL_MINT}&outputMint=${token.mint}&amount=${QUOTE_LAMPS}&slippageBps=100`);
        if (!r.ok) return;
        const q = await r.json();
        const out = Number(q?.outAmount || 0);
        const dec = Number(q?.outputDecimals ?? 6);
        if (!cancelled && out) setTps(out / Math.pow(10, dec));
      } catch {}
    }
    quote();
    const id = setInterval(quote, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token.mint]);

  const receiveAmount = useMemo(() => {
    if (!tps) return 'Quoting…';
    if (mode === 'buy') return format(amtNum * tps) + ' ' + token.sym;
    return (amtNum / tps).toFixed(4) + ' SOL';
  }, [amtNum, tps, mode, token.sym]);

  return (
    <>
      <div className="mw-sheet-backdrop mw-show" onClick={onClose}></div>
      <div className="mw-sheet mw-show">
        <div className="mw-grabber"></div>

        <div className="mw-sheet-token-head">
          <div className="mw-sheet-emoji">
            {token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}
          </div>
          <div className="mw-sheet-token-info">
            <div className="mw-sheet-token-name">{token.sym}</div>
            <div className="mw-sheet-sub">
              <span className={'mw-change-pill' + (isDown ? ' mw-down-pill' : '')}>
                {isDown ? '📉 ' : '📈 '}{formatPct(token.change)}
              </span>
              {token.age && <span className="mw-age-pill">{token.age}</span>}
            </div>
          </div>
          <button className="mw-icon-btn" onClick={onClose}>×</button>
        </div>

        <div className={'mw-tab-switch' + (mode === 'sell' ? ' mw-sell-mode' : '')}>
          <div className="mw-tab-indicator"></div>
          {['buy', 'sell'].map(m => (
            <div key={m} className={'mw-tab' + (mode === m ? ' mw-active' : '')} onClick={() => setMode(m)}>
              {m.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="mw-amount-section">
          <div className="mw-amount-label">
            <span>You Pay</span>
            <span className="mw-balance">~${usdValue}</span>
          </div>
          <div className="mw-amount-input-wrap">
            <input
              className="mw-amount-input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="mw-currency">
              <div className="mw-currency-icon"></div>
              SOL
            </div>
          </div>

          <div className="mw-presets">
            {['0.1', '0.5', '1', 'MAX'].map(p => (
              <button
                key={p}
                className={'mw-preset' + (selectedPreset === p ? ' mw-selected' : '')}
                onClick={() => handlePreset(p)}
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
            <b>{tps ? `1 SOL = ${format(tps)}` : '—'}</b>
          </div>
        </div>

        <div className="mw-cta-wrap">
          <button
            className={'mw-cta' + (mode === 'sell' ? ' mw-sell-cta' : '')}
            onClick={() => onConfirm(amtNum.toFixed(3), format(amtNum * tps))}
            disabled={!tps}
          >
            {mode === 'sell' ? '💸 DUMP ' + token.sym : '🚀 APE INTO ' + token.sym}
          </button>
          <div className="mw-trust">
            Powered by <span className="mw-jup-badge"><span className="mw-jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐
          </div>
        </div>
      </div>
    </>
  );
}

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
        <button className="mw-view-on">VIEW ON SOLSCAN ↗</button>
      </div>

      <div className="mw-success">
        <div className="mw-success-emoji">🎉</div>
        <div className="mw-success-title">YOU APED!</div>
        <div className="mw-success-sub">Welcome to the {token.sym} chat, anon {token.emoji}</div>
      </div>

      <div className="mw-flex-card">
        <div className="mw-flex-top">
          <div className="mw-flex-emoji">{token.icon ? <img src={token.icon} alt={token.sym} /> : token.emoji}</div>
          <div className="mw-flex-token">
            <div className="mw-flex-sym">${token.sym}</div>
            <div className="mw-flex-tag">{token.name} · <b>{formatPct(token.change)} 24h</b></div>
          </div>
        </div>
        <div className="mw-flex-row"><span className="mw-flex-label">You paid</span><span className="mw-flex-value">{data.paid} SOL</span></div>
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
