import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import './MemeWonderland.css';
 
// ===== TOKEN DATA (replace with API/on-chain data later) =====
const TOKENS = {
  hoppy:  { emoji: '🐸', sym: 'HOPPY',    full: 'Hoppy The Frog · Solana', price: '$0.0000418', change: '+247%', age: '3D OLD', tokensPer: 2356588, hot: true },
  fart:   { emoji: '💨', sym: 'FARTCOIN', full: 'Fartcoin · Solana',        price: '$0.0000218', change: '+412%', age: '1D OLD', tokensPer: 4521000, hot: true },
  chonk:  { emoji: '🐱', sym: 'CHONK',    full: 'Chonky Cat · Solana',      price: '$0.0001124', change: '+68%',  age: '12H OLD', tokensPer: 876000 },
  pepe:   { emoji: '🐸', sym: 'PEPE',     full: 'Pepe · Solana',            price: '$0.0000089', change: '+18.4%',age: '2Y OLD', tokensPer: 11000000 },
  wif:    { emoji: '🐶', sym: 'WIF',      full: 'dogwifhat · Solana',       price: '$2.42',      change: '+9.1%', age: '1Y OLD', tokensPer: 40.5 },
  bonk:   { emoji: '🐕', sym: 'BONK',     full: 'Bonk · Solana',            price: '$0.0000412', change: '-2.8%', age: '2Y OLD', tokensPer: 2400000 },
  mog:    { emoji: '😼', sym: 'MOGCAT',   full: 'Mog Cat · Solana',         price: '$0.0000031', change: '+89%',  age: '2H OLD', tokensPer: 31800000, fresh: true },
  cards:  { emoji: '🎴', sym: 'CARDS',    full: 'CARDS · Solana',           price: '$0.1765',    change: '+5.83%',age: '45D OLD', tokensPer: 555 }
};

const TICKER = [
  ['SOL', '-1.37%', false], ['HOPPY', '+247%', true], ['PEPE', '+18.4%', true],
  ['WIF', '+9.1%', true], ['BONK', '-2.8%', false], ['CARDS', '+5.83%', true],
  ['FART', '+412%', true], ['CHONK', '+68%', true]
];

const SOL_PRICE = 85.14;
const SOL_BALANCE = 0.0382; // wire to real balance later

function format(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  return n.toFixed(2);
}

function shortAddr(a) {
  if (!a) return 'Connect';
  const s = a.toString();
  return s.slice(0, 4) + '...' + s.slice(-4);
}

export default function MemeWonderland() {
  const { publicKey } = useWallet();
  const refCode = publicKey ? publicKey.toString().slice(0, 6) : 'guest';

  const [activeFilter, setActiveFilter] = useState('Trending');
  const [detailToken, setDetailToken] = useState(null);
  const [sheetToken, setSheetToken] = useState(null);
  const [mode, setMode] = useState('buy');
  const [amount, setAmount] = useState('0.50');
  const [selectedPreset, setSelectedPreset] = useState('0.5');
  const [success, setSuccess] = useState(null); // {token, paid, got}
  const [chartTf, setChartTf] = useState('24H');
  const [feedTab, setFeedTab] = useState('LIVE TRADES');

  const openDetail = (token) => {
    setDetailToken(token);
    window.scrollTo(0, 0);
  };
  const closeDetail = () => setDetailToken(null);

  const openSheet = (token, m, e) => {
    if (e) e.stopPropagation();
    setSheetToken(token);
    setMode(m);
    setAmount('0.50');
    setSelectedPreset('0.5');
  };
  const closeSheet = () => setSheetToken(null);

  const handlePreset = (amt) => {
    setSelectedPreset(amt);
    setAmount(amt === 'MAX' ? SOL_BALANCE.toString() : amt);
  };

  const handleAmount = (v) => {
    setAmount(v);
    setSelectedPreset(null);
  };

  const sheetT = sheetToken ? TOKENS[sheetToken] : null;
  const amtNum = parseFloat(amount) || 0;
  const usdValue = (amtNum * SOL_PRICE).toFixed(2);
  const receiveAmount = useMemo(() => {
    if (!sheetT) return '';
    if (mode === 'buy') return format(amtNum * sheetT.tokensPer) + ' ' + sheetT.sym;
    return (amtNum / sheetT.tokensPer * SOL_PRICE).toFixed(4) + ' SOL';
  }, [amtNum, sheetT, mode]);

  const confirmTrade = () => {
    const t = TOKENS[sheetToken];
    setSuccess({
      token: sheetToken,
      paid: amtNum.toFixed(2),
      got: format(amtNum * t.tokensPer),
      price: t.price
    });
    setSheetToken(null);
    setDetailToken(null);
  };

  const closeSuccess = () => setSuccess(null);

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

        <div className="mw-ticker-strip">
          <div className="mw-ticker-track">
            {[...TICKER, ...TICKER].map(([sym, change, up], i) => (
              <span className="mw-ticker-item" key={i}>
                <span className="mw-sym">{sym}</span>
                <span className={up ? 'mw-up' : 'mw-down'}>{change}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="mw-search-wrap">
          <div className="mw-search">
            <span>🔍</span>
            <input placeholder="Search ticker, name, or paste contract" />
          </div>
        </div>

        <div className="mw-filters">
          {['Trending', '🔥 1H', '6H', '24H', '🆕 New', '⭐ Watch'].map(f => (
            <div
              key={f}
              className={'mw-chip' + (activeFilter === f ? ' mw-active' : '')}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </div>
          ))}
        </div>

        <div className="mw-section-head">
          <div className="mw-section-title">HOT RIGHT NOW</div>
          <div className="mw-section-meta">AUTO · 5s</div>
        </div>

        <div className="mw-grid">
          {Object.entries(TOKENS).map(([key, t], i) => (
            <div
              key={key}
              className={'mw-card' + (t.hot ? ' mw-hot' : '') + (t.fresh ? ' mw-fresh' : '')}
              style={{ animationDelay: `${0.05 + i * 0.05}s` }}
              onClick={() => openDetail(key)}
            >
              {t.hot && <div className="mw-hot-badge">🔥 HOT</div>}
              {t.fresh && <div className="mw-fresh-badge">🆕 NEW</div>}
              <div className="mw-card-top">
                <div className="mw-token-icon">{t.emoji}</div>
                <div className="mw-token-meta">
                  <div className="mw-token-sym">{t.sym}</div>
                  <div className="mw-token-age">{t.age}</div>
                </div>
              </div>
              <div className={'mw-change ' + (t.change.startsWith('-') ? 'mw-down' : 'mw-up')}>
                {t.change}
                <span className="mw-change-label">24H</span>
              </div>
              <div className="mw-actions">
                <button className="mw-mini-btn mw-buy" onClick={(e) => openSheet(key, 'buy', e)}>BUY</button>
                <button className="mw-mini-btn mw-sell" onClick={(e) => openSheet(key, 'sell', e)}>SELL</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DETAIL OVERLAY */}
      {detailToken && (
        <DetailView
          token={detailToken}
          chartTf={chartTf}
          setChartTf={setChartTf}
          feedTab={feedTab}
          setFeedTab={setFeedTab}
          onClose={closeDetail}
          onTrade={(m) => openSheet(detailToken, m)}
        />
      )}

      {/* TRADE SHEET */}
      {sheetToken && (
        <TradeSheet
          token={sheetToken}
          mode={mode}
          setMode={setMode}
          amount={amount}
          setAmount={handleAmount}
          selectedPreset={selectedPreset}
          handlePreset={handlePreset}
          usdValue={usdValue}
          receiveAmount={receiveAmount}
          onClose={closeSheet}
          onConfirm={confirmTrade}
        />
      )}

      {/* SUCCESS */}
      {success && (
        <SuccessView
          data={success}
          refCode={refCode}
          onClose={closeSuccess}
        />
      )}
    </div>
  );
}

/* ============================= DETAIL ============================= */
function DetailView({ token, chartTf, setChartTf, feedTab, setFeedTab, onClose, onTrade }) {
  const t = TOKENS[token];
  const isDown = t.change.startsWith('-');

  useEffect(() => {
    const el = document.querySelector('.mw-detail');
    if (el) el.scrollTop = 0;
  }, [token]);

  return (
    <div className="mw-detail mw-show">
      <div className="mw-detail-top">
        <button className="mw-icon-btn" onClick={onClose}>←</button>
        <div className="mw-detail-title">${t.sym} <span className="mw-check-mint">✓</span></div>
        <button className="mw-icon-btn">↗</button>
      </div>

      <div className="mw-detail-hero">
        <div className="mw-detail-emoji">{t.emoji}</div>
        <div className="mw-detail-info">
          <div className="mw-detail-name">{t.sym}</div>
          <div className="mw-detail-fullname">{t.full}</div>
          <div className="mw-detail-price-row">
            <div className="mw-detail-price">{t.price}</div>
            <span className={'mw-change-pill' + (isDown ? ' mw-down-pill' : '')}>
              {isDown ? '📉 ' : '📈 '}{t.change}
            </span>
          </div>
        </div>
      </div>

      <div className="mw-inline-actions">
        <button className="mw-big-btn mw-buy" onClick={() => onTrade('buy')}>🚀 BUY</button>
        <button className="mw-big-btn mw-sell" onClick={() => onTrade('sell')}>💸 SELL</button>
      </div>

      <div className="mw-chart-wrap">
        <div className="mw-chart-header">
          <span className="mw-chart-label">📊 PRICE</span>
          <div className="mw-timeframes">
            {['1H', '6H', '24H', '7D'].map(tf => (
              <div key={tf} className={'mw-tf' + (chartTf === tf ? ' mw-active' : '')} onClick={() => setChartTf(tf)}>
                {tf}
              </div>
            ))}
          </div>
        </div>
        <svg className="mw-sparkline" viewBox="0 0 400 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mwLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4dffd2" />
              <stop offset="100%" stopColor="#4dff88" />
            </linearGradient>
            <linearGradient id="mwFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4dffd2" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#4dffd2" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 0 85 L 20 80 L 40 78 L 60 72 L 80 70 L 100 68 L 120 60 L 140 55 L 160 50 L 180 45 L 200 42 L 220 38 L 240 32 L 260 28 L 280 22 L 300 18 L 320 14 L 340 10 L 360 8 L 380 7 L 400 5 L 400 100 L 0 100 Z" fill="url(#mwFillGrad)" />
          <path d="M 0 85 L 20 80 L 40 78 L 60 72 L 80 70 L 100 68 L 120 60 L 140 55 L 160 50 L 180 45 L 200 42 L 220 38 L 240 32 L 260 28 L 280 22 L 300 18 L 320 14 L 340 10 L 360 8 L 380 7 L 400 5" fill="none" stroke="url(#mwLineGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 2px 8px rgba(77,255,210,0.5))' }} />
          <circle cx="400" cy="5" r="5" fill="#4dffd2" />
          <circle cx="400" cy="5" r="9" fill="#4dffd2" opacity="0.3">
            <animate attributeName="r" values="5;14;5" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      <div className="mw-stats-grid">
        <div className="mw-stat mw-mcap"><span className="mw-stat-icon">💰</span><div className="mw-stat-label">Market Cap</div><div className="mw-stat-value">$2.4M</div><div className="mw-stat-sub mw-up">+$1.8M today</div></div>
        <div className="mw-stat mw-holders"><span className="mw-stat-icon">{t.emoji}</span><div className="mw-stat-label">Holders</div><div className="mw-stat-value">4,231</div><div className="mw-stat-sub mw-up">+892 today</div></div>
        <div className="mw-stat mw-volume"><span className="mw-stat-icon">⚡</span><div className="mw-stat-label">Volume 24h</div><div className="mw-stat-value">$1.2M</div><div className="mw-stat-sub">8,492 trades</div></div>
        <div className="mw-stat mw-liq"><span className="mw-stat-icon">💧</span><div className="mw-stat-label">Liquidity</div><div className="mw-stat-value">$340K</div><div className="mw-stat-sub">🔒 Locked</div></div>
      </div>

      <div className="mw-safety">
        <div className="mw-safety-title">🛡️ SAFETY CHECKS</div>
        <div className="mw-safety-checks">
          <div className="mw-safety-check"><div className="mw-check-dot">✓</div> LP locked</div>
          <div className="mw-safety-check"><div className="mw-check-dot">✓</div> Mint renounced</div>
          <div className="mw-safety-check"><div className="mw-check-dot">✓</div> No mint auth</div>
          <div className="mw-safety-check"><div className="mw-check-dot">✓</div> Top 10: 18%</div>
        </div>
      </div>

      <div className="mw-socials">
        <div className="mw-socials-row">
          <a className="mw-social"><span className="mw-social-icon">𝕏</span><div className="mw-social-label">Twitter</div><div className="mw-social-count">12.4K</div></a>
          <a className="mw-social"><span className="mw-social-icon">✈️</span><div className="mw-social-label">Telegram</div><div className="mw-social-count">3.2K</div></a>
          <a className="mw-social"><span className="mw-social-icon">🌐</span><div className="mw-social-label">Web</div><div className="mw-social-count">↗</div></a>
          <a className="mw-social"><span className="mw-social-icon">📊</span><div className="mw-social-label">Chart</div><div className="mw-social-count">↗</div></a>
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
          {[
            { side: 'buy',  amount: '2.4M ' + t.sym,  wallet: '7xKn...e4Pq', value: '+$100.42', time: '2s ago' },
            { side: 'buy',  amount: '580K ' + t.sym,  wallet: 'Bp3a...M9zX', value: '+$24.18',  time: '8s ago' },
            { side: 'sell', amount: '1.1M ' + t.sym,  wallet: 'Fr8m...kT2N', value: '-$45.92',  time: '14s ago' },
            { side: 'buy',  amount: '12.5M ' + t.sym, wallet: 'Hg2c...wQ8L', value: '+$522.30', time: '22s ago' },
          ].map((tx, i) => (
            <div key={i} className="mw-feed-item">
              <div className={'mw-feed-side mw-' + tx.side}>{tx.side.toUpperCase()}</div>
              <div className="mw-feed-mid">
                <div className="mw-feed-amount">{tx.amount}</div>
                <div className="mw-feed-wallet">{tx.wallet}</div>
              </div>
              <div className="mw-feed-right">
                <div className="mw-feed-value" style={{ color: tx.side === 'buy' ? 'var(--mw-green)' : 'var(--mw-red)' }}>{tx.value}</div>
                <div className="mw-feed-time">{tx.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mw-contract">
        <div className="mw-contract-info">
          <div className="mw-contract-label">Contract</div>
          <div className="mw-contract-addr">HoP7sQ2k...8eRfNXcM</div>
        </div>
        <button className="mw-copy-btn">COPY</button>
      </div>
    </div>
  );
}

/* ============================= TRADE SHEET ============================= */
function TradeSheet({ token, mode, setMode, amount, setAmount, selectedPreset, handlePreset, usdValue, receiveAmount, onClose, onConfirm }) {
  const t = TOKENS[token];
  const isDown = t.change.startsWith('-');

  return (
    <>
      <div className="mw-sheet-backdrop mw-show" onClick={onClose}></div>
      <div className="mw-sheet mw-show">
        <div className="mw-grabber"></div>

        <div className="mw-sheet-token-head">
          <div className="mw-sheet-emoji">{t.emoji}</div>
          <div className="mw-sheet-token-info">
            <div className="mw-sheet-token-name">{t.sym}</div>
            <div className="mw-sheet-sub">
              <span className={'mw-change-pill' + (isDown ? ' mw-down-pill' : '')}>
                {isDown ? '📉 ' : '📈 '}{t.change}
              </span>
              <span className="mw-age-pill">{t.age}</span>
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
            <span className="mw-balance">Balance <b>{SOL_BALANCE} SOL</b></span>
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
          <div className="mw-usd-value">≈ ${usdValue}</div>

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
          <div className="mw-receive-rate">Rate<br /><b>1 SOL = {format(t.tokensPer)}</b></div>
        </div>

        <div className="mw-cta-wrap">
          <button
            className={'mw-cta' + (mode === 'sell' ? ' mw-sell-cta' : '')}
            onClick={onConfirm}
          >
            {mode === 'sell' ? '💸 DUMP ' + t.sym : '🚀 APE INTO ' + t.sym}
          </button>
          <div className="mw-trust">
            Powered by <span className="mw-jup-badge"><span className="mw-jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐
          </div>
        </div>
      </div>
    </>
  );
}

/* ============================= SUCCESS ============================= */
function SuccessView({ data, refCode, onClose }) {
  const t = TOKENS[data.token];
  const [confetti, setConfetti] = useState([]);

  useEffect(() => {
    const emojis = ['🎉','🚀','💎','🐸','✨','🍭','💸','⭐','🌈'];
    const pieces = Array.from({ length: 36 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 100,
      duration: 3 + Math.random() * 3,
      delay: Math.random() * 1.5,
      size: 16 + Math.random() * 14
    }));
    setConfetti(pieces);
  }, []);

  const handleShareX = useCallback(() => {
    const text = `Just aped into $${t.sym} on @nexus 🚀\n\nBag: ${data.got}\nEntry: ${data.price}\n\nFollow the pump 👇`;
    const url = `https://nexus.app/t/${data.token}?ref=${refCode}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  }, [data, t, refCode]);

  const handleShareTG = useCallback(() => {
    const url = `https://nexus.app/t/${data.token}?ref=${refCode}`;
    const text = `Just aped into $${t.sym} on Nexus 🚀 Bag: ${data.got}`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
  }, [data, t, refCode]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard?.writeText(`https://nexus.app/t/${data.token}?ref=${refCode}`);
  }, [data, refCode]);

  const handleCopyRef = useCallback(() => {
    navigator.clipboard?.writeText(`https://nexus.app/t/${data.token}?ref=${refCode}`);
  }, [data, refCode]);

  return (
    <div className="mw-success-overlay mw-show">
      <div className="mw-confetti-rain">
        {confetti.map(p => (
          <div
            key={p.id}
            className="mw-confetti-piece"
            style={{
              left: p.left + '%',
              animationDuration: p.duration + 's',
              animationDelay: p.delay + 's',
              fontSize: p.size + 'px'
            }}
          >{p.emoji}</div>
        ))}
      </div>

      <div className="mw-success-top">
        <button className="mw-icon-btn" onClick={onClose}>×</button>
        <button className="mw-view-on">VIEW ON SOLSCAN ↗</button>
      </div>

      <div className="mw-success">
        <div className="mw-success-emoji">🎉</div>
        <div className="mw-success-title">YOU APED!</div>
        <div className="mw-success-sub">Welcome to the {t.sym} chat, anon {t.emoji}</div>
      </div>

      <div className="mw-flex-card">
        <div className="mw-flex-top">
          <div className="mw-flex-emoji">{t.emoji}</div>
          <div className="mw-flex-token">
            <div className="mw-flex-sym">${t.sym}</div>
            <div className="mw-flex-tag">{t.full.split(' · ')[0]} · <b>{t.change} 24h</b></div>
          </div>
        </div>
        <div className="mw-flex-row"><span className="mw-flex-label">You paid</span><span className="mw-flex-value">{data.paid} SOL</span></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Bag size</span><span className="mw-flex-value mw-big">{data.got}</span></div>
        <div className="mw-flex-divider"></div>
        <div className="mw-flex-row"><span className="mw-flex-label">Entry</span><span className="mw-flex-value" style={{ fontSize: '13px' }}>{data.price}</span></div>
        <div className="mw-flex-watermark">VIA <b>NEXUS</b></div>
      </div>

      <div className="mw-share-section">
        <div className="mw-share-title">FLEX YOUR BAG 💪</div>
        <div className="mw-share-sub">Earn <b>20%</b> of fees from anyone who apes with your link</div>
        <div className="mw-share-grid">
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#000', '--mw-share-color': '#fff' }} onClick={handleShareX}>
            <div className="mw-share-icon">𝕏</div><div className="mw-share-label">Post on X</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': '#229ED9', '--mw-share-color': '#fff' }} onClick={handleShareTG}>
            <div className="mw-share-icon">✈</div><div className="mw-share-label">Telegram</div>
          </button>
          <button className="mw-share-btn" style={{ '--mw-share-bg': 'rgba(77,255,210,0.18)', '--mw-share-color': '#4dffd2' }} onClick={handleCopyLink}>
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
          <span className="mw-refer-url">nexus.app/t/{data.token}?ref=<b>{refCode}</b></span>
          <button className="mw-refer-copy" onClick={handleCopyRef}>COPY</button>
        </div>
      </div>

      <div className="mw-done-wrap">
        <button className="mw-done-btn" onClick={onClose}>🚀 BACK TO WONDERLAND</button>
      </div>
    </div>
  );
}
