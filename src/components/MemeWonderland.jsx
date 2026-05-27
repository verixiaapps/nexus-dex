import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import './MemeWonderland.css';
 
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const POLL_TOKENS  = 10_000;
const POLL_TICK    = 5_000;
const POLL_SOL     = 30_000;
const MAX_TICKS    = 144;
const QUOTE_LAMPS  = 1_000_000_000;

const FILTERS = [
  { key: 'trending', label: 'Trending', tf: '24h' },
  { key: '1h',       label: '🔥 1H',    tf: '1h'  },
  { key: '6h',       label: '6H',       tf: '6h'  },
  { key: '24h',      label: '24H',      tf: '24h' },
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

  const [detailMint, setDetailMint] = useState(null);
  const [sheetMint,  setSheetMint]  = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null);
  const [chartTf, setChartTf] = useState('24H');
  const [feedTab, setFeedTab] = useState('LIVE TRADES');

  useEffect(() => {
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

  const ticker = useMemo(() => {
    return tokens.slice(0, 8).map(t => [t.sym, formatPct(t.change), t.change >= 0]);
  }, [tokens]);

  const tokenByMint = useCallback(m => tokens.find(t => t.mint === m), [tokens]);

  const openDetail = (mint) => { setDetailMint(mint); window.scrollTo(0, 0); };
  const closeDetail = () => setDetailMint(null);
  const openSheet = (mint, m, e) => {
    if (e) e.stopPropagation();
    setSheetMint(mint); setMode(m);
    setAmount('0.50'); setSelectedPreset('0.5');
  };
  const closeSheet = () => setSheetMint(null);
  const handlePreset = (amt) => { setSelectedPreset(amt); setAmount(amt === 'MAX' ? '1.0' : amt); };
  const handleAmount = (v) => { setAmount(v); setSelectedPreset(null); };

  return (
    <div className="mw-root">
      <div className="mw-ambient">
        <span>🐸</span><span>🚀</span><span>💎</span><span>🍭</span>
      </div>

      <div className="mw-phone">
        <div className="mw-header">
          <div className="mw-logo">
            <div className="mw-logo-mark">N</div>
            NEXUS <span className="mw-dex-pill">DEX</span>
          </div>
          <div className="mw-wallet-pill">
            <span className="mw-wallet-dot"></span>
            {shortAddr(publicKey)}
          </div>
        </div>

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
          {FILTERS.map(f => (
            <div
              key={f.key}
              className={'mw-chip' + (activeFilter === f.key ? ' mw-active' : '')}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </div>
          ))}
        </div>

        <div className="mw-section-head">
          <div className="mw-section-title">
            {activeFilter === 'new' ? 'FRESH LAUNCHES'
              : activeFilter === 'watch' ? 'WATCHLIST'
              : 'HOT RIGHT NOW'}
          </div>
          <div className="mw-section-meta">{loading ? 'LOADING…' : `LIVE · ${tokens.length}`}</div>
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
            <div className="mw-empty">No tokens right now. Try another filter.</div>
          ) : (
            tokens.slice(0, 12).map((t, i) => (
              <div
                key={t.mint}
                className={'mw-card' + (t.hot ? ' mw-hot' : '') + (t.fresh ? ' mw-fresh' : '')}
                style={{ animationDelay: `${0.03 + i * 0.04}s` }}
                onClick={() => openDetail(t.mint)}
              >
                {t.hot && <div className="mw-hot-badge">🔥 HOT</div>}
                {t.fresh && !t.hot && <div className="mw-fresh-badge">🆕 NEW</div>}
                <div className="mw-card-top">
                  <div className="mw-token-icon">
                    {t.icon
                      ? <img src={t.icon} alt={t.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      : t.emoji}
                  </div>
                  <div className="mw-token-meta">
                    <div className="mw-token-sym">{t.sym}</div>
                    <div className="mw-token-age">{t.age || formatPrice(t.price)}</div>
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
          solPrice={solPrice}
          chartTf={chartTf}
          setChartTf={setChartTf}
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

function DetailView({ token, solPrice, chartTf, setChartTf, feedTab, setFeedTab, onClose, onTrade }) {
  const isDown = token.change < 0;
  const [ticks, setTicks] = useState(() => token.price > 0 ? [{ t: Date.now(), p: token.price }] : []);

  useEffect(() => {
    setTicks(token.price > 0 ? [{ t: Date.now(), p: token.price }] : []);
  }, [token.mint]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        if (!solPrice) return;
        const r = await fetch(`/api/jupiter/quote?inputMint=${SOL_MINT}&outputMint=${token.mint}&amount=${QUOTE_LAMPS}&slippageBps=50`);
        if (!r.ok) return;
        const q = await r.json();
        const outAmount = Number(q?.outAmount || 0);
        const decimals  = Number(q?.outputDecimals ?? 6);
        if (!outAmount) return;
        const tps = outAmount / Math.pow(10, decimals);
        const usd = solPrice / tps;
        if (cancelled || !Number.isFinite(usd) || usd <= 0) return;
        setTicks(prev => {
          const next = [...prev, { t: Date.now(), p: usd }];
          return next.length > MAX_TICKS ? next.slice(-MAX_TICKS) : next;
        });
      } catch {}
    }
    tick();
    const id = setInterval(tick, POLL_TICK);
    return () => { cancelled = true; clearInterval(id); };
  }, [token.mint, solPrice]);

  const visible = useMemo(() => {
    const lim = { '1H': 12, '6H': 36, '24H': MAX_TICKS, '7D': MAX_TICKS }[chartTf] || MAX_TICKS;
    return ticks.slice(-lim);
  }, [ticks, chartTf]);

  const { linePath, fillPath, lastX, lastY, color } = useMemo(() => {
    if (visible.length < 2) return { linePath: '', fillPath: '', lastX: 400, lastY: 50, color: '#4dffd2' };
    const W = 400, H = 100;
    const prices = visible.map(t => t.p);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || max * 0.001 || 1;
    const pts = visible.map((t, i) => [
      (i / (visible.length - 1)) * W,
      H - ((t.p - min) / range) * (H - 10) - 5
    ]);
    const linePath = pts.map((p, i) => (i ? 'L' : 'M') + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const fillPath = linePath + ` L ${W} ${H} L 0 ${H} Z`;
    const up = prices[prices.length - 1] >= prices[0];
    return { linePath, fillPath, lastX: pts[pts.length - 1][0], lastY: pts[pts.length - 1][1], color: up ? '#4dffd2' : '#ff5577' };
  }, [visible]);

  const currentPrice = visible.length ? visible[visible.length - 1].p : token.price;

  useEffect(() => {
    const el = document.querySelector('.mw-detail');
    if (el) el.scrollTop = 0;
  }, [token.mint]);

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
            <div className="mw-detail-price">{formatPrice(currentPrice)}</div>
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

      <div className="mw-chart-wrap">
        <div className="mw-chart-header">
          <span className="mw-chart-label">📊 LIVE PRICE <span className="mw-live-dot-sm"></span></span>
          <div className="mw-timeframes">
            {['1H', '6H', '24H', '7D'].map(tf => (
              <div key={tf} className={'mw-tf' + (chartTf === tf ? ' mw-active' : '')} onClick={() => setChartTf(tf)}>
                {tf}
              </div>
            ))}
          </div>
        </div>
        {visible.length < 2 ? (
          <div className="mw-chart-loading">
            <span className="mw-pulse-dot"></span> Building live chart… first tick in ~5s
          </div>
        ) : (
          <svg className="mw-sparkline" viewBox="0 0 400 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`mwFill-${token.mint}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={fillPath} fill={`url(#mwFill-${token.mint})`} />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 2px 6px ${color}80)` }} />
            <circle cx={lastX} cy={lastY} r="4" fill={color} />
            <circle cx={lastX} cy={lastY} r="8" fill={color} opacity="0.3">
              <animate attributeName="r" values="4;12;4" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
          </svg>
        )}
      </div>

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
