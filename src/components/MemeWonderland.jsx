<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Nexus — Meme Wonderland v2</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Unbounded:wght@400;600;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #07070b;
    --bg-card: #0e0e15;
    --bg-card-hi: #14141e;
    --border: rgba(255,255,255,0.06);
    --border-hi: rgba(255,255,255,0.12);
    --text: #f4f4f8;
    --text-dim: #8a8a9a;
    --text-dimmer: #50505c;
    --green: #4ade80;
    --green-glow: rgba(74,222,128,0.25);
    --red: #ff5577;
    --red-glow: rgba(255,85,119,0.2);
    --mint: #7df9d8;
    --pink: #ff6ec7;
    --purple: #a78bfa;
    --cyan: #67e8f9;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Space Mono', monospace;
    min-height: 100vh;
    overflow-x: hidden;
  }
  body {
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, rgba(167,139,250,0.12), transparent 60%),
      radial-gradient(ellipse 60% 40% at 90% 30%, rgba(125,249,216,0.06), transparent 60%),
      var(--bg);
    background-attachment: fixed;
  }
  .phone {
    max-width: 430px;
    margin: 0 auto;
    min-height: 100vh;
    position: relative;
    padding-bottom: 88px;
  }
  /* HEADER */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--border);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: 'Unbounded', sans-serif;
    font-weight: 900;
    letter-spacing: 0.02em;
    font-size: 18px;
  }
  .logo-mark {
    width: 28px; height: 28px;
    border-radius: 7px;
    background: linear-gradient(135deg, #4ec5ff 0%, #67e8f9 100%);
    display: grid; place-items: center;
    color: #07070b;
    font-weight: 900;
    box-shadow: 0 0 20px rgba(78,197,255,0.4);
  }
  .dex-pill {
    font-size: 9px;
    border: 1px solid var(--cyan);
    color: var(--cyan);
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.1em;
    margin-left: 4px;
  }
  .wallet-pill {
    border: 1px solid var(--mint);
    color: var(--mint);
    font-size: 11px;
    padding: 6px 12px;
    border-radius: 999px;
    display: flex; align-items: center; gap: 6px;
    font-weight: 700;
  }
  .wallet-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--mint);
    box-shadow: 0 0 8px var(--mint);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.4; } }

  /* HERO - tightened */
  .hero {
    padding: 18px 18px 14px;
  }
  .live-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    letter-spacing: 0.15em;
    color: var(--pink);
    border: 1px solid rgba(255,110,199,0.3);
    background: rgba(255,110,199,0.06);
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
  }
  .live-tag::before {
    content: '';
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--pink);
    box-shadow: 0 0 6px var(--pink);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .hero h1 {
    font-family: 'Unbounded', sans-serif;
    font-weight: 800;
    font-size: 32px;
    line-height: 1;
    margin: 10px 0 8px;
    letter-spacing: -0.02em;
  }
  .hero h1 .wonder {
    background: linear-gradient(90deg, #ff6ec7 0%, #a78bfa 50%, #67e8f9 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-style: italic;
    font-weight: 400;
  }
  .hero p {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.4;
    max-width: 320px;
  }

  /* TICKER STRIP */
  .ticker-strip {
    margin: 12px 0 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,0.01);
    overflow: hidden;
    position: relative;
  }
  .ticker-track {
    display: flex;
    gap: 28px;
    padding: 10px 0;
    white-space: nowrap;
    animation: ticker 30s linear infinite;
    width: max-content;
  }
  @keyframes ticker {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
  .ticker-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
  }
  .ticker-item .sym { color: var(--text-dim); }
  .up { color: var(--green); }
  .down { color: var(--red); }

  /* SEARCH */
  .search-wrap {
    padding: 14px 18px 8px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 14px;
    transition: border-color 0.2s;
  }
  .search:focus-within { border-color: var(--border-hi); }
  .search input {
    background: none;
    border: none;
    color: var(--text);
    font-family: 'Space Mono', monospace;
    font-size: 13px;
    flex: 1;
    outline: none;
  }
  .search input::placeholder { color: var(--text-dimmer); }
  .search-icon { color: var(--text-dim); }

  /* FILTERS */
  .filters {
    display: flex;
    gap: 8px;
    padding: 4px 18px 14px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .filters::-webkit-scrollbar { display: none; }
  .chip {
    flex: 0 0 auto;
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-dim);
    background: var(--bg-card);
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.15s;
  }
  .chip.active {
    color: var(--mint);
    border-color: var(--mint);
    background: rgba(125,249,216,0.06);
    box-shadow: 0 0 20px rgba(125,249,216,0.1);
  }
  .chip .fire { font-size: 10px; }

  /* SECTION HEADER */
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 6px 18px 12px;
  }
  .section-title {
    font-family: 'Unbounded', sans-serif;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::before {
    content: '';
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--pink);
    box-shadow: 0 0 8px var(--pink);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .section-meta {
    font-size: 10px;
    color: var(--text-dimmer);
    letter-spacing: 0.1em;
  }

  /* TOKEN GRID */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 18px;
  }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 14px 12px 12px;
    position: relative;
    overflow: hidden;
    transition: transform 0.15s, border-color 0.15s;
  }
  .card:active { transform: scale(0.98); }
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 100% 60% at 50% 0%, var(--card-glow, transparent), transparent 70%);
    pointer-events: none;
    opacity: 0.5;
  }
  .card.hot { border-color: rgba(255,110,199,0.2); --card-glow: rgba(255,110,199,0.15); }
  .card.up   { border-color: rgba(74,222,128,0.15); --card-glow: rgba(74,222,128,0.1); }
  .card-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    position: relative;
  }
  .token-icon {
    width: 36px; height: 36px;
    border-radius: 50%;
    display: grid; place-items: center;
    font-weight: 900;
    font-size: 14px;
    color: #07070b;
    flex-shrink: 0;
  }
  .token-meta { min-width: 0; flex: 1; }
  .token-sym {
    font-family: 'Unbounded', sans-serif;
    font-weight: 800;
    font-size: 15px;
    letter-spacing: -0.01em;
    line-height: 1;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .token-age {
    font-size: 9px;
    color: var(--text-dimmer);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .change {
    font-family: 'Unbounded', sans-serif;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
    line-height: 1;
    position: relative;
    margin-bottom: 14px;
  }
  .change.up { color: var(--green); text-shadow: 0 0 20px var(--green-glow); }
  .change.down { color: var(--red); text-shadow: 0 0 20px var(--red-glow); }
  .change-label {
    font-size: 9px;
    color: var(--text-dimmer);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    display: block;
    margin-top: 4px;
    font-family: 'Space Mono', monospace;
    font-weight: 400;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    position: relative;
  }
  .btn {
    border: none;
    padding: 10px 0;
    border-radius: 10px;
    font-family: 'Unbounded', sans-serif;
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: transform 0.1s, filter 0.15s;
  }
  .btn:active { transform: scale(0.96); }
  .buy {
    background: var(--mint);
    color: #07070b;
    box-shadow: 0 0 24px rgba(125,249,216,0.25);
  }
  .buy:hover { filter: brightness(1.1); }
  .sell {
    background: transparent;
    color: var(--red);
    border: 1px solid rgba(255,85,119,0.3);
  }
  .sell:hover { background: rgba(255,85,119,0.08); }

  /* HOT badge */
  .hot-badge {
    position: absolute;
    top: 10px; right: 10px;
    font-size: 8px;
    background: rgba(255,110,199,0.15);
    color: var(--pink);
    border: 1px solid rgba(255,110,199,0.3);
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.1em;
    font-weight: 800;
  }

  /* BOTTOM NAV */
  .nav {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: rgba(7,7,11,0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-around;
    padding: 10px 0 14px;
    z-index: 50;
  }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--text-dimmer);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-decoration: none;
  }
  .nav-item.active { color: var(--cyan); }
  .nav-item.active::before {
    content: '';
    position: absolute;
    top: 0;
    width: 28px;
    height: 2px;
    background: var(--cyan);
    box-shadow: 0 0 8px var(--cyan);
    border-radius: 0 0 4px 4px;
  }
  .nav-icon { font-size: 18px; }

  /* GRAIN */
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
    opacity: 0.03;
    z-index: 100;
  }

  /* Fade in cards */
  .card { animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
  .card:nth-child(1) { animation-delay: 0.05s; }
  .card:nth-child(2) { animation-delay: 0.1s; }
  .card:nth-child(3) { animation-delay: 0.15s; }
  .card:nth-child(4) { animation-delay: 0.2s; }
  .card:nth-child(5) { animation-delay: 0.25s; }
  .card:nth-child(6) { animation-delay: 0.3s; }
  .card:nth-child(7) { animation-delay: 0.35s; }
  .card:nth-child(8) { animation-delay: 0.4s; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
<div class="phone">
  <!-- HEADER -->
  <div class="header">
    <div class="logo">
      <div class="logo-mark">N</div>
      NEXUS <span class="dex-pill">DEX</span>
    </div>
    <div class="wallet-pill">
      <span class="wallet-dot"></span>
      Dd6b...NRFV
    </div>
  </div>

  <!-- HERO (tightened) -->
  <div class="hero">
    <span class="live-tag">LIVE MEME MARKET</span>
    <h1>Meme <span class="wonder">wonderland</span></h1>
    <p>Solana memes, routed through Jupiter. One tap to ape.</p>
  </div>

  <!-- TICKER STRIP -->
  <div class="ticker-strip">
    <div class="ticker-track">
      <span class="ticker-item"><span class="sym">SOL</span> <span class="down">-1.37%</span></span>
      <span class="ticker-item"><span class="sym">HOPPY</span> <span class="up">+247%</span></span>
      <span class="ticker-item"><span class="sym">PEPE</span> <span class="up">+18.4%</span></span>
      <span class="ticker-item"><span class="sym">WIF</span> <span class="up">+9.1%</span></span>
      <span class="ticker-item"><span class="sym">BONK</span> <span class="down">-2.8%</span></span>
      <span class="ticker-item"><span class="sym">CARDS</span> <span class="up">+5.83%</span></span>
      <span class="ticker-item"><span class="sym">FART</span> <span class="up">+412%</span></span>
      <span class="ticker-item"><span class="sym">CHONK</span> <span class="up">+68%</span></span>
      <!-- duplicate for seamless loop -->
      <span class="ticker-item"><span class="sym">SOL</span> <span class="down">-1.37%</span></span>
      <span class="ticker-item"><span class="sym">HOPPY</span> <span class="up">+247%</span></span>
      <span class="ticker-item"><span class="sym">PEPE</span> <span class="up">+18.4%</span></span>
      <span class="ticker-item"><span class="sym">WIF</span> <span class="up">+9.1%</span></span>
      <span class="ticker-item"><span class="sym">BONK</span> <span class="down">-2.8%</span></span>
      <span class="ticker-item"><span class="sym">CARDS</span> <span class="up">+5.83%</span></span>
      <span class="ticker-item"><span class="sym">FART</span> <span class="up">+412%</span></span>
      <span class="ticker-item"><span class="sym">CHONK</span> <span class="up">+68%</span></span>
    </div>
  </div>

  <!-- SEARCH -->
  <div class="search-wrap">
    <div class="search">
      <span class="search-icon">🔍</span>
      <input placeholder="Search ticker, name, or paste contract" />
    </div>
  </div>

  <!-- FILTERS -->
  <div class="filters">
    <div class="chip active">Trending</div>
    <div class="chip"><span class="fire">🔥</span> 1H</div>
    <div class="chip">6H</div>
    <div class="chip">24H</div>
    <div class="chip">NEW</div>
    <div class="chip">⭐ Watch</div>
  </div>

  <!-- SECTION HEADER -->
  <div class="section-head">
    <div class="section-title">HOT RIGHT NOW</div>
    <div class="section-meta">AUTO · 5s</div>
  </div>

  <!-- TOKEN GRID -->
  <div class="grid">

    <div class="card hot">
      <div class="hot-badge">🔥 HOT</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fbbf24, #84cc16);">H</div>
        <div class="token-meta">
          <div class="token-sym">HOPPY</div>
          <div class="token-age">3D OLD</div>
        </div>
      </div>
      <div class="change up">+247%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card hot">
      <div class="hot-badge">🔥 HOT</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #f472b6, #c084fc);">F</div>
        <div class="token-meta">
          <div class="token-sym">FARTCOIN</div>
          <div class="token-age">1D OLD</div>
        </div>
      </div>
      <div class="change up">+412%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card up">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #4ade80, #06b6d4);">C</div>
        <div class="token-meta">
          <div class="token-sym">CHONK</div>
          <div class="token-age">12H OLD</div>
        </div>
      </div>
      <div class="change up">+68%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card up">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #60a5fa, #818cf8);">P</div>
        <div class="token-meta">
          <div class="token-sym">PEPE</div>
          <div class="token-age">2Y OLD</div>
        </div>
      </div>
      <div class="change up">+18.4%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card up">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fcd34d, #f59e0b);">W</div>
        <div class="token-meta">
          <div class="token-sym">WIF</div>
          <div class="token-age">1Y OLD</div>
        </div>
      </div>
      <div class="change up">+9.1%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fb923c, #ef4444);">B</div>
        <div class="token-meta">
          <div class="token-sym">BONK</div>
          <div class="token-age">2Y OLD</div>
        </div>
      </div>
      <div class="change down">-2.8%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card hot">
      <div class="hot-badge">🆕 NEW</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #a78bfa, #ec4899);">M</div>
        <div class="token-meta">
          <div class="token-sym">MOGCAT</div>
          <div class="token-age">2H OLD</div>
        </div>
      </div>
      <div class="change up">+89%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

    <div class="card up">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #67e8f9, #818cf8);">C</div>
        <div class="token-meta">
          <div class="token-sym">CARDS</div>
          <div class="token-age">45D OLD</div>
        </div>
      </div>
      <div class="change up">+5.83%
        <span class="change-label">24H</span>
      </div>
      <div class="actions">
        <button class="btn buy">BUY</button>
        <button class="btn sell">SELL</button>
      </div>
    </div>

  </div>

  <!-- BOTTOM NAV -->
  <div class="nav">
    <a class="nav-item"><span class="nav-icon">⇅</span>Swap</a>
    <a class="nav-item"><span class="nav-icon">🌉</span>Bridge</a>
    <a class="nav-item active"><span class="nav-icon">★</span>Wonderland</a>
    <a class="nav-item"><span class="nav-icon">📈</span>Markets</a>
    <a class="nav-item"><span class="nav-icon">▢</span>Wallet</a>
  </div>
</div>
</body>
</html>
