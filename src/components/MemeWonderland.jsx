<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Nexus — Wonderland 🥞</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Space+Mono:wght@400;700&family=Unbounded:wght@600;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0815;
    --bg-deep: #050410;
    --card: #1a1530;
    --card-hi: #241d42;
    --card-deep: #2a2350;
    --border: rgba(255,255,255,0.08);
    --border-hi: rgba(255,255,255,0.18);
    --text: #fff5fb;
    --text-dim: #b9a7d6;
    --text-dimmer: #6c5d8c;

    --mint: #4dffd2;
    --mint-hi: #7dffe0;
    --pink: #ff5ec4;
    --pink-hi: #ffb3e3;
    --yellow: #ffe14d;
    --orange: #ff9a3c;
    --purple: #c084fc;
    --cyan: #5ee8ff;
    --green: #4dff88;
    --red: #ff5577;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Fredoka', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }
  body {
    background:
      radial-gradient(circle at 20% 0%, rgba(255,94,196,0.18), transparent 50%),
      radial-gradient(circle at 80% 30%, rgba(77,255,210,0.15), transparent 50%),
      radial-gradient(circle at 50% 80%, rgba(192,132,252,0.12), transparent 60%),
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

  /* Ambient floaters */
  .ambient {
    position: fixed; inset: 0; pointer-events: none;
    max-width: 430px; margin: 0 auto; overflow: hidden; z-index: 0;
  }
  .ambient span {
    position: absolute; font-size: 18px; opacity: 0.25;
    animation: drift 12s ease-in-out infinite;
  }
  .ambient span:nth-child(1) { top: 12%; left: 6%; animation-delay: 0s; }
  .ambient span:nth-child(2) { top: 30%; right: 8%; animation-delay: 3s; font-size: 22px; }
  .ambient span:nth-child(3) { top: 60%; left: 10%; animation-delay: 6s; }
  .ambient span:nth-child(4) { top: 78%; right: 12%; animation-delay: 1.5s; font-size: 20px; }
  @keyframes drift {
    0%, 100% { transform: translate(0, 0) rotate(-10deg); }
    50% { transform: translate(8px, -20px) rotate(10deg); }
  }

  /* HEADER */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 18px 12px;
    position: sticky; top: 0; z-index: 30;
    background: linear-gradient(180deg, var(--bg) 80%, transparent);
    backdrop-filter: blur(8px);
  }
  .logo {
    display: flex; align-items: center; gap: 10px;
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    letter-spacing: 0.02em; font-size: 18px;
  }
  .logo-mark {
    width: 28px; height: 28px; border-radius: 7px;
    background: linear-gradient(135deg, #4ec5ff, var(--cyan));
    display: grid; place-items: center;
    color: var(--bg-deep); font-weight: 900;
    box-shadow: 0 0 20px rgba(78,197,255,0.4);
  }
  .dex-pill {
    font-size: 9px; border: 1px solid var(--cyan); color: var(--cyan);
    padding: 2px 6px; border-radius: 4px; letter-spacing: 0.1em;
    margin-left: 4px;
  }
  .wallet-pill {
    border: 1px solid var(--mint); color: var(--mint);
    font-size: 11px; padding: 6px 12px; border-radius: 999px;
    display: flex; align-items: center; gap: 6px; font-weight: 700;
  }
  .wallet-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--mint); box-shadow: 0 0 8px var(--mint);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.4; } }

  /* HERO */
  .hero { padding: 8px 18px 12px; position: relative; z-index: 2; }
  .live-tag {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 10px; letter-spacing: 0.15em; color: var(--pink);
    border: 1px solid rgba(255,94,196,0.3); background: rgba(255,94,196,0.06);
    padding: 4px 10px; border-radius: 999px; font-weight: 700;
  }
  .live-tag::before {
    content: ''; width: 5px; height: 5px; border-radius: 50%;
    background: var(--pink); box-shadow: 0 0 6px var(--pink);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .hero h1 {
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 30px; line-height: 1; margin: 10px 0 8px;
    letter-spacing: -0.02em;
  }
  .hero h1 .wonder {
    background: linear-gradient(90deg, var(--pink) 0%, var(--purple) 50%, var(--cyan) 100%);
    -webkit-background-clip: text; background-clip: text;
    color: transparent; font-style: italic; font-weight: 400;
  }
  .hero p { color: var(--text-dim); font-size: 12px; line-height: 1.4; max-width: 320px; font-weight: 500; }

  /* TICKER */
  .ticker-strip {
    margin: 12px 0 0;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,0.01); overflow: hidden;
    position: relative; z-index: 2;
  }
  .ticker-track {
    display: flex; gap: 28px; padding: 10px 0;
    white-space: nowrap; animation: ticker 30s linear infinite;
    width: max-content;
  }
  @keyframes ticker {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
  .ticker-item { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; }
  .ticker-item .sym { color: var(--text-dim); }
  .up { color: var(--green); }
  .down { color: var(--red); }

  /* SEARCH */
  .search-wrap { padding: 14px 18px 8px; position: relative; z-index: 2; }
  .search {
    display: flex; align-items: center; gap: 10px;
    background: var(--card); border: 1.5px solid var(--border);
    border-radius: 14px; padding: 12px 14px; transition: border-color 0.2s;
  }
  .search:focus-within { border-color: var(--border-hi); }
  .search input {
    background: none; border: none; color: var(--text);
    font-family: 'Fredoka', sans-serif; font-size: 13px; flex: 1; outline: none;
    font-weight: 500;
  }
  .search input::placeholder { color: var(--text-dimmer); }

  /* FILTERS */
  .filters {
    display: flex; gap: 8px; padding: 4px 18px 14px;
    overflow-x: auto; scrollbar-width: none; position: relative; z-index: 2;
  }
  .filters::-webkit-scrollbar { display: none; }
  .chip {
    flex: 0 0 auto; padding: 7px 14px;
    border: 1.5px solid var(--border); border-radius: 999px;
    font-size: 11px; font-weight: 700; color: var(--text-dim);
    background: var(--card); letter-spacing: 0.05em; cursor: pointer;
    transition: all 0.15s; font-family: 'Fredoka', sans-serif;
  }
  .chip.active {
    color: #0a0815;
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    border-color: var(--mint);
    box-shadow: 0 2px 12px rgba(77,255,210,0.3);
  }

  /* SECTION HEADER */
  .section-head {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 6px 18px 12px; position: relative; z-index: 2;
  }
  .section-title {
    font-family: 'Unbounded', sans-serif; font-size: 11px;
    font-weight: 800; letter-spacing: 0.2em; color: var(--text);
    display: flex; align-items: center; gap: 8px;
  }
  .section-title::before {
    content: ''; width: 6px; height: 6px; border-radius: 50%;
    background: var(--pink); box-shadow: 0 0 8px var(--pink);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .section-meta {
    font-size: 10px; color: var(--text-dimmer); letter-spacing: 0.1em;
  }

  /* GRID */
  .grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 10px; padding: 0 18px; position: relative; z-index: 2;
  }
  .card {
    background: var(--card); border: 1.5px solid var(--border);
    border-radius: 18px; padding: 14px 12px 12px;
    position: relative; overflow: hidden;
    transition: transform 0.15s, border-color 0.15s;
    cursor: pointer;
    box-shadow: 0 3px 0 rgba(0,0,0,0.2);
  }
  .card:active { transform: scale(0.97) translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,0.2); }
  .card::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse 100% 60% at 50% 0%, var(--card-glow, transparent), transparent 70%);
    pointer-events: none; opacity: 0.6;
  }
  .card.hot { border-color: rgba(255,94,196,0.22); --card-glow: rgba(255,94,196,0.18); }
  .card.fresh { border-color: rgba(255,225,77,0.22); --card-glow: rgba(255,225,77,0.15); }
  .card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .token-icon {
    width: 38px; height: 38px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 20px; flex-shrink: 0;
    box-shadow: inset 0 -2px 0 rgba(0,0,0,0.15);
  }
  .token-meta { min-width: 0; flex: 1; }
  .token-sym {
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 15px; letter-spacing: -0.01em; line-height: 1;
    margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .token-age {
    font-size: 9px; color: var(--text-dimmer);
    letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;
  }
  .change {
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 22px; letter-spacing: -0.02em; line-height: 1;
    position: relative; margin-bottom: 12px;
  }
  .change.up { color: var(--green); text-shadow: 0 0 18px rgba(77,255,136,0.3); }
  .change.down { color: var(--red); text-shadow: 0 0 18px rgba(255,85,119,0.25); }
  .change-label {
    font-size: 9px; color: var(--text-dimmer); letter-spacing: 0.15em;
    text-transform: uppercase; display: block; margin-top: 4px;
    font-family: 'Fredoka', sans-serif; font-weight: 600;
  }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; position: relative; }
  .mini-btn {
    border: none; padding: 9px 0; border-radius: 10px;
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 10px; letter-spacing: 0.12em; cursor: pointer;
    transition: transform 0.1s, filter 0.15s;
    box-shadow: 0 2px 0 rgba(0,0,0,0.2);
  }
  .mini-btn:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,0.2); }
  .mini-btn.buy {
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    color: #0a0815;
    box-shadow: 0 2px 0 rgba(0,0,0,0.2), 0 0 18px rgba(77,255,210,0.2);
  }
  .mini-btn.sell {
    background: transparent; color: var(--pink);
    border: 1.5px solid rgba(255,94,196,0.4);
  }
  .hot-badge {
    position: absolute; top: 10px; right: 10px;
    font-size: 8px;
    background: rgba(255,94,196,0.18); color: var(--pink);
    border: 1px solid rgba(255,94,196,0.35);
    padding: 3px 7px; border-radius: 6px;
    letter-spacing: 0.1em; font-weight: 800;
  }
  .fresh-badge {
    position: absolute; top: 10px; right: 10px;
    font-size: 8px;
    background: rgba(255,225,77,0.18); color: var(--yellow);
    border: 1px solid rgba(255,225,77,0.35);
    padding: 3px 7px; border-radius: 6px;
    letter-spacing: 0.1em; font-weight: 800;
  }

  /* BOTTOM NAV */
  .nav {
    position: fixed; bottom: 0; left: 0; right: 0;
    max-width: 430px; margin: 0 auto;
    background: rgba(7,7,11,0.92);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--border);
    display: flex; justify-content: space-around;
    padding: 10px 0 14px; z-index: 50;
  }
  .nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-size: 10px; color: var(--text-dimmer); font-weight: 700;
    letter-spacing: 0.05em; text-decoration: none;
    cursor: pointer; position: relative;
  }
  .nav-item.active { color: var(--cyan); }
  .nav-item.active::before {
    content: ''; position: absolute; top: -10px;
    width: 28px; height: 2px; background: var(--cyan);
    box-shadow: 0 0 8px var(--cyan); border-radius: 0 0 4px 4px;
  }
  .nav-icon { font-size: 18px; }

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

  /* ============ DETAIL OVERLAY ============ */
  .detail-overlay {
    position: fixed; inset: 0; max-width: 430px; margin: 0 auto;
    background: var(--bg); z-index: 40;
    overflow-y: auto; padding-bottom: 100px;
    display: none;
    background:
      radial-gradient(circle at 10% 0%, rgba(255,225,77,0.12), transparent 45%),
      radial-gradient(circle at 90% 20%, rgba(77,255,136,0.15), transparent 50%),
      radial-gradient(circle at 50% 70%, rgba(255,94,196,0.1), transparent 55%),
      var(--bg);
  }
  .detail-overlay.show { display: block; animation: slideInRight 0.3s ease-out; }
  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .detail-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 18px; position: sticky; top: 0; z-index: 5;
    background: linear-gradient(180deg, var(--bg) 80%, transparent);
    backdrop-filter: blur(8px);
  }
  .icon-btn {
    width: 40px; height: 40px; border-radius: 50%;
    background: rgba(255,255,255,0.06); border: 1px solid var(--border);
    color: var(--text); font-size: 18px; cursor: pointer;
    display: grid; place-items: center; font-weight: 600;
  }
  .detail-title {
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 14px; display: flex; align-items: center; gap: 6px;
  }
  .check-mint { color: var(--mint); font-size: 12px; }

  .detail-hero {
    padding: 4px 22px 14px;
    display: flex; align-items: center; gap: 14px;
  }
  .detail-emoji {
    font-size: 52px; line-height: 1; flex-shrink: 0;
    animation: bounce 2.5s ease-in-out infinite;
    filter: drop-shadow(0 6px 18px rgba(77,255,136,0.4));
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0) rotate(-4deg); }
    50% { transform: translateY(-6px) rotate(4deg); }
  }
  .detail-info { flex: 1; min-width: 0; }
  .detail-name {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 24px; letter-spacing: -0.02em; line-height: 1;
    background: linear-gradient(135deg, var(--yellow), var(--green), var(--mint));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .detail-fullname { color: var(--text-dim); font-weight: 600; font-size: 12px; margin-top: 3px; }
  .detail-price-row {
    display: flex; align-items: center; gap: 10px;
    margin-top: 10px; flex-wrap: wrap;
  }
  .detail-price {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 22px; letter-spacing: -0.02em; line-height: 1;
  }
  .change-pill {
    background: linear-gradient(135deg, var(--green), var(--mint));
    color: #0a0815; padding: 4px 10px; border-radius: 999px;
    font-weight: 700; font-size: 11px;
    box-shadow: 0 2px 10px rgba(77,255,136,0.3), inset 0 -2px 0 rgba(0,0,0,0.1);
  }

  .inline-actions {
    padding: 0 22px 14px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  }
  .big-btn {
    border: none; padding: 16px 0; border-radius: 16px;
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 13px; letter-spacing: 0.12em; cursor: pointer;
    transition: all 0.15s cubic-bezier(0.2, 1.2, 0.4, 1);
  }
  .big-btn.buy {
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    color: #0a0815;
    box-shadow:
      0 8px 24px rgba(77,255,210,0.4),
      0 4px 0 rgba(0,0,0,0.25),
      inset 0 -3px 0 rgba(0,0,0,0.12),
      inset 0 2px 0 rgba(255,255,255,0.3);
  }
  .big-btn.sell {
    background: linear-gradient(135deg, var(--pink), var(--red));
    color: #fff;
    box-shadow:
      0 8px 24px rgba(255,94,196,0.4),
      0 4px 0 rgba(0,0,0,0.25),
      inset 0 -3px 0 rgba(0,0,0,0.18),
      inset 0 2px 0 rgba(255,255,255,0.2);
  }
  .big-btn:active { transform: translateY(4px); }
  .big-btn.buy:active { box-shadow: 0 4px 12px rgba(77,255,210,0.3), 0 0 0 rgba(0,0,0,0.25), inset 0 -3px 0 rgba(0,0,0,0.12); }
  .big-btn.sell:active { box-shadow: 0 4px 12px rgba(255,94,196,0.3), 0 0 0 rgba(0,0,0,0.25), inset 0 -3px 0 rgba(0,0,0,0.18); }

  /* SPARKLINE */
  .chart-wrap {
    margin: 0 22px;
    background: linear-gradient(180deg, rgba(77,255,210,0.06), rgba(94,232,255,0.02));
    border: 1.5px solid rgba(77,255,210,0.18);
    border-radius: 20px; padding: 16px 14px 10px;
    position: relative; overflow: hidden;
  }
  .chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .chart-label { font-size: 11px; color: var(--text-dim); letter-spacing: 0.15em; font-weight: 700; text-transform: uppercase; }
  .timeframes { display: flex; gap: 3px; background: rgba(0,0,0,0.3); padding: 3px; border-radius: 10px; }
  .tf {
    padding: 5px 9px; font-size: 10px; font-weight: 700;
    color: var(--text-dim); border-radius: 7px; cursor: pointer;
    font-family: 'Unbounded', sans-serif; letter-spacing: 0.05em;
  }
  .tf.active {
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    color: #0a0815; box-shadow: 0 2px 8px rgba(77,255,210,0.3);
  }
  .sparkline { width: 100%; height: 100px; display: block; margin-top: 6px; }

  .stats-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 10px; padding: 14px 22px 0;
  }
  .stat {
    background: var(--card); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 12px 14px 10px;
    position: relative; overflow: hidden;
  }
  .stat::before {
    content: ''; position: absolute; top: 0; right: 0;
    width: 60px; height: 60px;
    background: radial-gradient(circle, var(--stat-glow, transparent), transparent 70%);
    opacity: 0.6;
  }
  .stat.mcap { --stat-glow: rgba(192,132,252,0.3); }
  .stat.holders { --stat-glow: rgba(77,255,136,0.3); }
  .stat.volume { --stat-glow: rgba(255,225,77,0.3); }
  .stat.liq { --stat-glow: rgba(94,232,255,0.3); }
  .stat-icon { font-size: 16px; margin-bottom: 2px; display: block; }
  .stat-label {
    font-size: 9px; color: var(--text-dim); letter-spacing: 0.15em;
    text-transform: uppercase; font-weight: 700; margin-bottom: 2px;
  }
  .stat-value {
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 18px; letter-spacing: -0.01em;
  }
  .stat-sub { font-size: 9px; color: var(--text-dimmer); font-weight: 600; margin-top: 2px; }
  .stat-sub.up { color: var(--green); }

  .safety {
    margin: 14px 22px 0; padding: 12px 14px;
    background: rgba(77,255,136,0.06);
    border: 1.5px solid rgba(77,255,136,0.22);
    border-radius: 16px;
  }
  .safety-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 10px; color: var(--green); font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;
  }
  .safety-checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
  .safety-check {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--text); font-weight: 600;
  }
  .check-dot {
    width: 13px; height: 13px; border-radius: 50%;
    background: var(--green); color: #0a0815;
    display: grid; place-items: center;
    font-size: 8px; font-weight: 900;
    box-shadow: 0 0 6px rgba(77,255,136,0.4);
  }

  .socials { margin: 14px 22px 0; }
  .socials-row { display: flex; gap: 8px; }
  .social {
    flex: 1; background: var(--card); border: 1.5px solid var(--border);
    border-radius: 14px; padding: 10px 6px 8px; text-align: center;
    cursor: pointer; transition: all 0.2s cubic-bezier(0.2, 1.2, 0.4, 1);
    box-shadow: 0 2px 0 rgba(0,0,0,0.2);
    text-decoration: none; color: var(--text);
  }
  .social:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,0.2); }
  .social-icon { font-size: 16px; margin-bottom: 3px; display: block; }
  .social-label { font-size: 9px; font-weight: 700; color: var(--text-dim); letter-spacing: 0.05em; }
  .social-count {
    font-size: 10px; color: var(--text); font-weight: 700; margin-top: 2px;
    font-family: 'Unbounded', sans-serif;
  }

  .feed {
    margin: 14px 22px 0; background: var(--card);
    border: 1.5px solid var(--border); border-radius: 16px; overflow: hidden;
  }
  .feed-tabs { display: flex; border-bottom: 1px solid var(--border); }
  .feed-tab {
    flex: 1; padding: 11px 0; text-align: center;
    font-family: 'Unbounded', sans-serif; font-weight: 700;
    font-size: 10px; letter-spacing: 0.1em;
    color: var(--text-dim); cursor: pointer; position: relative;
  }
  .feed-tab.active { color: var(--mint); }
  .feed-tab.active::after {
    content: ''; position: absolute; bottom: 0; left: 25%; right: 25%;
    height: 2px; background: var(--mint); border-radius: 2px 2px 0 0;
    box-shadow: 0 0 8px var(--mint);
  }
  .feed-list { padding: 4px 0; }
  .feed-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .feed-item:last-child { border-bottom: none; }
  .feed-side {
    width: 34px; height: 24px; border-radius: 7px;
    display: grid; place-items: center;
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 8px; letter-spacing: 0.05em;
  }
  .feed-side.buy { background: rgba(77,255,136,0.15); color: var(--green); }
  .feed-side.sell { background: rgba(255,85,119,0.15); color: var(--red); }
  .feed-mid { flex: 1; }
  .feed-amount { font-weight: 700; font-size: 12px; }
  .feed-wallet { font-size: 9px; color: var(--text-dimmer); font-family: 'Space Mono', monospace; margin-top: 2px; }
  .feed-right { text-align: right; }
  .feed-value { font-weight: 700; font-size: 11px; }
  .feed-time { font-size: 9px; color: var(--text-dimmer); margin-top: 2px; }

  .contract {
    margin: 14px 22px 0; padding: 12px 14px;
    background: rgba(255,255,255,0.03);
    border: 1px dashed var(--border-hi); border-radius: 14px;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .contract-info { min-width: 0; flex: 1; }
  .contract-label {
    font-size: 9px; color: var(--text-dim); letter-spacing: 0.15em;
    text-transform: uppercase; font-weight: 700; margin-bottom: 2px;
  }
  .contract-addr {
    font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .copy-btn {
    background: var(--card-hi); border: 1px solid var(--border-hi);
    color: var(--mint); padding: 7px 12px; border-radius: 9px;
    font-family: 'Unbounded', sans-serif; font-weight: 700;
    font-size: 10px; letter-spacing: 0.1em; cursor: pointer; flex-shrink: 0;
  }

  /* ============ TRADE SHEET ============ */
  .sheet-backdrop {
    position: fixed; inset: 0; max-width: 430px; margin: 0 auto;
    background: rgba(7,7,11,0.6); backdrop-filter: blur(8px);
    z-index: 60; display: none;
  }
  .sheet-backdrop.show { display: block; animation: fadeIn 0.2s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .sheet {
    position: fixed; bottom: 0; left: 0; right: 0;
    max-width: 430px; margin: 0 auto;
    background: linear-gradient(180deg, #1a1530 0%, var(--bg-deep) 100%);
    border-top-left-radius: 32px; border-top-right-radius: 32px;
    border-top: 2px solid rgba(255,255,255,0.08);
    padding: 8px 0 24px; max-height: 92vh;
    z-index: 65; display: none;
    box-shadow: 0 -20px 60px rgba(255,94,196,0.15);
  }
  .sheet.show { display: block; animation: slideUp 0.4s cubic-bezier(0.2, 1.2, 0.4, 1); }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  .grabber {
    width: 44px; height: 4px; background: rgba(255,255,255,0.18);
    border-radius: 999px; margin: 0 auto 14px;
  }
  .sheet-token-head {
    padding: 4px 22px 16px; display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid var(--border);
  }
  .sheet-emoji {
    width: 52px; height: 52px; border-radius: 50%;
    background: linear-gradient(135deg, #ffe14d, #4dff88);
    display: grid; place-items: center; font-size: 26px;
    box-shadow: 0 0 0 4px rgba(77,255,136,0.15), 0 0 30px rgba(255,225,77,0.3);
  }
  .sheet-token-info { flex: 1; min-width: 0; }
  .sheet-token-name {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 20px; line-height: 1; margin-bottom: 6px;
  }
  .sheet-sub { display: flex; align-items: center; gap: 8px; }
  .age-pill {
    background: rgba(255,255,255,0.06); color: var(--text-dim);
    padding: 3px 8px; border-radius: 999px;
    font-weight: 600; font-size: 10px; letter-spacing: 0.05em;
  }

  .tab-switch {
    display: grid; grid-template-columns: 1fr 1fr;
    margin: 16px 22px 0; background: var(--bg-deep);
    border-radius: 14px; padding: 4px; position: relative;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
  }
  .tab {
    padding: 11px 0; text-align: center;
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 12px; letter-spacing: 0.12em;
    color: var(--text-dim); border-radius: 10px;
    cursor: pointer; transition: color 0.2s;
    position: relative; z-index: 2;
  }
  .tab-indicator {
    position: absolute; top: 4px; bottom: 4px;
    width: calc(50% - 4px);
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    border-radius: 10px;
    transition: transform 0.4s cubic-bezier(0.2, 1.3, 0.4, 1), background 0.3s;
    z-index: 1; box-shadow: 0 4px 18px rgba(77,255,210,0.35), inset 0 -2px 0 rgba(0,0,0,0.1);
  }
  .tab-switch.sell-mode .tab-indicator {
    transform: translateX(100%);
    background: linear-gradient(135deg, var(--pink), var(--red));
    box-shadow: 0 4px 18px rgba(255,94,196,0.35), inset 0 -2px 0 rgba(0,0,0,0.1);
  }
  .tab.active { color: #0a0815; }

  .amount-section { padding: 18px 22px; }
  .amount-label {
    font-size: 10px; color: var(--text-dim); letter-spacing: 0.18em;
    margin-bottom: 10px; display: flex; justify-content: space-between;
    align-items: center; text-transform: uppercase; font-weight: 700;
  }
  .balance {
    color: var(--text-dim); font-size: 10px;
    background: rgba(255,255,255,0.04); padding: 4px 10px; border-radius: 999px;
  }
  .balance b { color: var(--mint); font-weight: 700; }
  .amount-input-wrap {
    background: var(--card); border: 2px solid var(--border);
    border-radius: 18px; padding: 16px; display: flex;
    align-items: center; gap: 10px; transition: all 0.25s;
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.15);
  }
  .amount-input-wrap:focus-within {
    border-color: var(--mint);
    box-shadow: 0 0 0 4px rgba(77,255,210,0.12), inset 0 2px 4px rgba(0,0,0,0.15);
  }
  .amount-input {
    background: none; border: none; color: var(--text);
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 30px; flex: 1; outline: none;
    letter-spacing: -0.02em; min-width: 0;
  }
  .currency {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, var(--card-hi), var(--card));
    padding: 8px 12px 8px 8px; border-radius: 999px;
    font-weight: 700; font-family: 'Unbounded', sans-serif;
    font-size: 13px; border: 1px solid var(--border-hi);
  }
  .currency-icon {
    width: 22px; height: 22px; border-radius: 50%;
    background: linear-gradient(135deg, #9945ff, #14f195);
  }
  .usd-value { font-size: 11px; color: var(--text-dim); margin-top: 10px; text-align: right; font-weight: 600; }

  .presets {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 7px; margin-top: 12px;
  }
  .preset {
    background: var(--card); border: 2px solid var(--border);
    color: var(--text-dim); padding: 11px 0; border-radius: 12px;
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 12px; cursor: pointer;
    transition: all 0.15s cubic-bezier(0.2, 1.2, 0.4, 1);
    box-shadow: 0 2px 0 rgba(0,0,0,0.2);
  }
  .preset:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,0.2); }
  .preset.selected {
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    border-color: var(--mint-hi); color: #0a0815;
    box-shadow: 0 4px 18px rgba(77,255,210,0.35), 0 2px 0 rgba(0,0,0,0.2);
  }

  .receive {
    margin: 12px 22px 0; padding: 14px 16px;
    background: linear-gradient(135deg, rgba(77,255,210,0.08), rgba(94,232,255,0.04));
    border: 1.5px solid rgba(77,255,210,0.22);
    border-radius: 16px; display: flex;
    justify-content: space-between; align-items: center;
  }
  .receive-label {
    font-size: 9px; color: var(--text-dim); letter-spacing: 0.18em;
    text-transform: uppercase; font-weight: 700;
  }
  .receive-amount {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 16px; color: var(--mint-hi); margin-top: 3px;
  }
  .receive-rate {
    text-align: right; font-size: 9px; color: var(--text-dim);
    font-weight: 600; letter-spacing: 0.05em;
  }
  .receive-rate b {
    color: var(--text); font-family: 'Unbounded', sans-serif;
    font-weight: 800; font-size: 11px;
  }

  .cta-wrap { padding: 16px 22px 0; }
  .cta {
    width: 100%;
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    color: #0a0815; border: none; padding: 18px 0; border-radius: 18px;
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 14px; letter-spacing: 0.15em; cursor: pointer;
    box-shadow:
      0 8px 28px rgba(77,255,210,0.4),
      0 4px 0 rgba(0,0,0,0.25),
      inset 0 -3px 0 rgba(0,0,0,0.12),
      inset 0 2px 0 rgba(255,255,255,0.3);
    transition: all 0.15s cubic-bezier(0.2, 1.2, 0.4, 1);
    position: relative; overflow: hidden;
  }
  .cta:active { transform: translateY(4px); box-shadow: 0 4px 16px rgba(77,255,210,0.3), 0 0 0 rgba(0,0,0,0.25); }
  .cta.sell-cta {
    background: linear-gradient(135deg, var(--pink), var(--red));
    color: #fff;
  }
  .cta::after {
    content: ''; position: absolute; top: 0; bottom: 0;
    width: 70px; left: -110px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
    animation: shimmer 2.5s ease-in-out infinite;
  }
  @keyframes shimmer {
    0% { left: -110px; }
    50%, 100% { left: 130%; }
  }
  .trust {
    text-align: center; margin-top: 12px; font-size: 10px;
    color: var(--text-dim); letter-spacing: 0.05em; font-weight: 600;
  }
  .trust b { color: var(--text); font-weight: 800; }
  .jup-badge {
    display: inline-flex; align-items: center; gap: 5px;
    background: rgba(255,255,255,0.06); padding: 3px 9px;
    border-radius: 999px; margin: 0 3px;
  }
  .jup-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); }

  /* ============ SUCCESS OVERLAY ============ */
  .success-overlay {
    position: fixed; inset: 0; max-width: 430px; margin: 0 auto;
    background: var(--bg); z-index: 70;
    overflow-y: auto; padding: 16px 0 32px; display: none;
    background:
      radial-gradient(circle at 20% 10%, rgba(77,255,210,0.22), transparent 50%),
      radial-gradient(circle at 80% 30%, rgba(255,225,77,0.15), transparent 50%),
      radial-gradient(circle at 50% 80%, rgba(255,94,196,0.18), transparent 55%),
      var(--bg);
  }
  .success-overlay.show { display: block; }

  .confetti-rain {
    position: fixed; inset: 0; max-width: 430px; margin: 0 auto;
    pointer-events: none; overflow: hidden; z-index: 1;
  }
  .confetti-piece {
    position: absolute; top: -30px;
    animation: fall linear forwards;
  }
  @keyframes fall {
    0% { transform: translateY(-30px) rotate(0deg); opacity: 1; }
    100% { transform: translateY(110vh) rotate(720deg); opacity: 0.8; }
  }

  .success-top {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 18px 8px; position: relative; z-index: 5;
  }
  .view-on {
    background: rgba(255,255,255,0.06); border: 1px solid var(--border-hi);
    color: var(--text-dim); padding: 8px 12px; border-radius: 999px;
    font-family: 'Unbounded', sans-serif; font-weight: 700;
    font-size: 10px; letter-spacing: 0.1em; cursor: pointer;
  }

  .success { text-align: center; padding: 18px 22px 4px; position: relative; z-index: 5; }
  .success-emoji {
    font-size: 76px; line-height: 1;
    animation: pop 0.6s cubic-bezier(0.2, 1.5, 0.4, 1) backwards;
    filter: drop-shadow(0 10px 30px rgba(77,255,136,0.5));
  }
  @keyframes pop {
    0% { transform: scale(0) rotate(-90deg); opacity: 0; }
    60% { transform: scale(1.2) rotate(10deg); }
    100% { transform: scale(1) rotate(0); opacity: 1; }
  }
  .success-title {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 34px; letter-spacing: -0.02em; line-height: 1;
    margin-top: 8px;
    background: linear-gradient(135deg, var(--yellow), var(--green), var(--mint));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: rise 0.6s 0.2s backwards;
  }
  .success-sub {
    color: var(--text-dim); font-weight: 600; font-size: 13px; margin-top: 6px;
    animation: rise 0.6s 0.3s backwards;
  }

  .flex-card {
    margin: 18px 22px 0;
    background:
      radial-gradient(circle at 0% 0%, rgba(77,255,136,0.18), transparent 60%),
      radial-gradient(circle at 100% 100%, rgba(255,94,196,0.15), transparent 60%),
      linear-gradient(135deg, var(--card-hi), var(--card));
    border: 2px solid rgba(77,255,210,0.25);
    border-radius: 24px; padding: 20px 18px; position: relative; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 0 4px rgba(77,255,210,0.05);
    animation: rise 0.6s 0.4s backwards; z-index: 5;
  }
  .flex-watermark {
    position: absolute; bottom: 12px; right: 16px;
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 9px; color: var(--text-dimmer);
    letter-spacing: 0.2em; opacity: 0.6;
  }
  .flex-watermark b { color: var(--mint); }
  .flex-top { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .flex-emoji { font-size: 40px; line-height: 1; filter: drop-shadow(0 4px 12px rgba(77,255,136,0.4)); }
  .flex-token { flex: 1; min-width: 0; }
  .flex-sym {
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 22px; letter-spacing: -0.01em; line-height: 1; margin-bottom: 4px;
  }
  .flex-tag { font-size: 11px; color: var(--text-dim); font-weight: 600; }
  .flex-tag b { color: var(--green); }
  .flex-divider { height: 1px; background: linear-gradient(90deg, transparent, var(--border-hi), transparent); margin: 12px 0; }
  .flex-row { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; }
  .flex-label { font-size: 10px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; }
  .flex-value { font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: 14px; letter-spacing: -0.01em; }
  .flex-value.big {
    font-size: 26px;
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }

  .share-section { margin: 18px 22px 0; position: relative; z-index: 5; animation: rise 0.6s 0.5s backwards; }
  .share-title { text-align: center; font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: 12px; letter-spacing: 0.15em; color: var(--text); margin-bottom: 4px; }
  .share-sub { text-align: center; font-size: 11px; color: var(--text-dim); font-weight: 600; margin-bottom: 12px; }
  .share-sub b { color: var(--yellow); }
  .share-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .share-btn {
    background: var(--card); border: 1.5px solid var(--border);
    border-radius: 14px; padding: 12px 4px 9px; text-align: center;
    cursor: pointer; transition: all 0.2s cubic-bezier(0.2, 1.2, 0.4, 1);
    box-shadow: 0 3px 0 rgba(0,0,0,0.22); text-decoration: none; color: var(--text);
  }
  .share-btn:active { transform: translateY(3px); box-shadow: 0 0 0 rgba(0,0,0,0.22); }
  .share-icon {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--share-bg, var(--card-hi));
    margin: 0 auto 6px; display: grid; place-items: center;
    font-size: 16px; color: var(--share-color, var(--text));
    font-weight: 800; font-family: 'Unbounded', sans-serif;
  }
  .share-label { font-size: 10px; font-weight: 700; color: var(--text); letter-spacing: 0.02em; }

  .refer {
    margin: 14px 22px 0;
    background: linear-gradient(135deg, rgba(255,225,77,0.1), rgba(255,154,60,0.06));
    border: 1.5px dashed rgba(255,225,77,0.3);
    border-radius: 16px; padding: 12px 14px;
    position: relative; z-index: 5; animation: rise 0.6s 0.6s backwards;
  }
  .refer-row { display: flex; align-items: center; gap: 10px; }
  .refer-emoji { font-size: 24px; }
  .refer-text { flex: 1; min-width: 0; }
  .refer-title { font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: 12px; color: var(--yellow); letter-spacing: 0.02em; }
  .refer-sub { font-size: 10px; color: var(--text-dim); font-weight: 600; margin-top: 2px; }
  .refer-link {
    margin-top: 9px; display: flex; align-items: center;
    background: rgba(0,0,0,0.3); border-radius: 9px; padding: 7px 10px; gap: 8px;
  }
  .refer-url {
    flex: 1; font-family: 'Space Mono', monospace; font-size: 10px;
    color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .refer-url b { color: var(--mint); }
  .refer-copy {
    background: linear-gradient(135deg, var(--yellow), var(--orange));
    color: #1a0f0f; border: none; padding: 6px 11px; border-radius: 8px;
    font-family: 'Unbounded', sans-serif; font-weight: 800;
    font-size: 10px; letter-spacing: 0.1em; cursor: pointer;
    box-shadow: 0 2px 0 rgba(0,0,0,0.2);
  }
  .refer-copy:active { transform: translateY(2px); box-shadow: 0 0 0 rgba(0,0,0,0.2); }

  .done-wrap { padding: 18px 22px 0; position: relative; z-index: 5; animation: rise 0.6s 0.7s backwards; }
  .done-btn {
    width: 100%;
    background: linear-gradient(135deg, var(--mint), var(--cyan));
    color: #0a0815; border: none; padding: 16px 0; border-radius: 16px;
    font-family: 'Unbounded', sans-serif; font-weight: 900;
    font-size: 13px; letter-spacing: 0.15em; cursor: pointer;
    box-shadow:
      0 8px 24px rgba(77,255,210,0.4),
      0 4px 0 rgba(0,0,0,0.22),
      inset 0 -3px 0 rgba(0,0,0,0.12),
      inset 0 2px 0 rgba(255,255,255,0.3);
    transition: all 0.15s cubic-bezier(0.2, 1.2, 0.4, 1);
  }
  .done-btn:active { transform: translateY(4px); }
</style>
</head>
<body>

<!-- Ambient background floaters -->
<div class="ambient">
  <span>🐸</span><span>🚀</span><span>💎</span><span>🍭</span>
</div>

<div class="phone" id="mainPhone">

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

  <!-- HERO -->
  <div class="hero">
    <span class="live-tag">LIVE MEME MARKET</span>
    <h1>Meme <span class="wonder">wonderland</span></h1>
    <p>Solana memes, routed through Jupiter. One tap to ape.</p>
  </div>

  <!-- TICKER -->
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
      <span>🔍</span>
      <input placeholder="Search ticker, name, or paste contract" />
    </div>
  </div>

  <!-- FILTERS -->
  <div class="filters">
    <div class="chip active">Trending</div>
    <div class="chip">🔥 1H</div>
    <div class="chip">6H</div>
    <div class="chip">24H</div>
    <div class="chip">🆕 New</div>
    <div class="chip">⭐ Watch</div>
  </div>

  <!-- SECTION -->
  <div class="section-head">
    <div class="section-title">HOT RIGHT NOW</div>
    <div class="section-meta">AUTO · 5s</div>
  </div>

  <!-- GRID -->
  <div class="grid">

    <div class="card hot" data-token="hoppy">
      <div class="hot-badge">🔥 HOT</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fbbf24, #84cc16);">🐸</div>
        <div class="token-meta">
          <div class="token-sym">HOPPY</div>
          <div class="token-age">3D OLD</div>
        </div>
      </div>
      <div class="change up">+247%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'hoppy', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'hoppy', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card hot" data-token="fart">
      <div class="hot-badge">🔥 HOT</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #f472b6, #c084fc);">💨</div>
        <div class="token-meta">
          <div class="token-sym">FARTCOIN</div>
          <div class="token-age">1D OLD</div>
        </div>
      </div>
      <div class="change up">+412%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'fart', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'fart', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card" data-token="chonk">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #4ade80, #06b6d4);">🐱</div>
        <div class="token-meta">
          <div class="token-sym">CHONK</div>
          <div class="token-age">12H OLD</div>
        </div>
      </div>
      <div class="change up">+68%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'chonk', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'chonk', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card" data-token="pepe">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #60a5fa, #818cf8);">🐸</div>
        <div class="token-meta">
          <div class="token-sym">PEPE</div>
          <div class="token-age">2Y OLD</div>
        </div>
      </div>
      <div class="change up">+18.4%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'pepe', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'pepe', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card" data-token="wif">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fcd34d, #f59e0b);">🐶</div>
        <div class="token-meta">
          <div class="token-sym">WIF</div>
          <div class="token-age">1Y OLD</div>
        </div>
      </div>
      <div class="change up">+9.1%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'wif', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'wif', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card" data-token="bonk">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #fb923c, #ef4444);">🐕</div>
        <div class="token-meta">
          <div class="token-sym">BONK</div>
          <div class="token-age">2Y OLD</div>
        </div>
      </div>
      <div class="change down">-2.8%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'bonk', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'bonk', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card fresh" data-token="mog">
      <div class="fresh-badge">🆕 NEW</div>
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #a78bfa, #ec4899);">😼</div>
        <div class="token-meta">
          <div class="token-sym">MOGCAT</div>
          <div class="token-age">2H OLD</div>
        </div>
      </div>
      <div class="change up">+89%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'mog', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'mog', 'sell')">SELL</button>
      </div>
    </div>

    <div class="card" data-token="cards">
      <div class="card-top">
        <div class="token-icon" style="background: linear-gradient(135deg, #67e8f9, #818cf8);">🎴</div>
        <div class="token-meta">
          <div class="token-sym">CARDS</div>
          <div class="token-age">45D OLD</div>
        </div>
      </div>
      <div class="change up">+5.83%<span class="change-label">24H</span></div>
      <div class="actions">
        <button class="mini-btn buy" onclick="openSheet(event, 'cards', 'buy')">BUY</button>
        <button class="mini-btn sell" onclick="openSheet(event, 'cards', 'sell')">SELL</button>
      </div>
    </div>

  </div>
</div>

<!-- =================== DETAIL OVERLAY =================== -->
<div class="detail-overlay" id="detailOverlay">
  <div class="detail-top">
    <button class="icon-btn" onclick="closeDetail()">←</button>
    <div class="detail-title" id="detailTitle">$HOPPY <span class="check-mint">✓</span></div>
    <button class="icon-btn">↗</button>
  </div>

  <div class="detail-hero">
    <div class="detail-emoji" id="detailEmoji">🐸</div>
    <div class="detail-info">
      <div class="detail-name" id="detailName">HOPPY</div>
      <div class="detail-fullname" id="detailFullname">Hoppy The Frog · Solana</div>
      <div class="detail-price-row">
        <div class="detail-price" id="detailPrice">$0.0000418</div>
        <span class="change-pill" id="detailChange">📈 +247.3%</span>
      </div>
    </div>
  </div>

  <div class="inline-actions">
    <button class="big-btn buy" onclick="openSheetFromDetail('buy')">🚀 BUY</button>
    <button class="big-btn sell" onclick="openSheetFromDetail('sell')">💸 SELL</button>
  </div>

  <div class="chart-wrap">
    <div class="chart-header">
      <span class="chart-label">📊 PRICE</span>
      <div class="timeframes">
        <div class="tf">1H</div>
        <div class="tf">6H</div>
        <div class="tf active">24H</div>
        <div class="tf">7D</div>
      </div>
    </div>
    <svg class="sparkline" viewBox="0 0 400 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4dffd2"/>
          <stop offset="100%" stop-color="#4dff88"/>
        </linearGradient>
        <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4dffd2" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#4dffd2" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M 0 85 L 20 80 L 40 78 L 60 72 L 80 70 L 100 68 L 120 60 L 140 55 L 160 50 L 180 45 L 200 42 L 220 38 L 240 32 L 260 28 L 280 22 L 300 18 L 320 14 L 340 10 L 360 8 L 380 7 L 400 5 L 400 100 L 0 100 Z" fill="url(#fillGrad)"/>
      <path d="M 0 85 L 20 80 L 40 78 L 60 72 L 80 70 L 100 68 L 120 60 L 140 55 L 160 50 L 180 45 L 200 42 L 220 38 L 240 32 L 260 28 L 280 22 L 300 18 L 320 14 L 340 10 L 360 8 L 380 7 L 400 5" fill="none" stroke="url(#lineGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 8px rgba(77,255,210,0.5));"/>
      <circle cx="400" cy="5" r="5" fill="#4dffd2"/>
      <circle cx="400" cy="5" r="9" fill="#4dffd2" opacity="0.3">
        <animate attributeName="r" values="5;14;5" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite"/>
      </circle>
    </svg>
  </div>

  <div class="stats-grid">
    <div class="stat mcap">
      <span class="stat-icon">💰</span>
      <div class="stat-label">Market Cap</div>
      <div class="stat-value">$2.4M</div>
      <div class="stat-sub up">+$1.8M today</div>
    </div>
    <div class="stat holders">
      <span class="stat-icon">🐸</span>
      <div class="stat-label">Holders</div>
      <div class="stat-value">4,231</div>
      <div class="stat-sub up">+892 today</div>
    </div>
    <div class="stat volume">
      <span class="stat-icon">⚡</span>
      <div class="stat-label">Volume 24h</div>
      <div class="stat-value">$1.2M</div>
      <div class="stat-sub">8,492 trades</div>
    </div>
    <div class="stat liq">
      <span class="stat-icon">💧</span>
      <div class="stat-label">Liquidity</div>
      <div class="stat-value">$340K</div>
      <div class="stat-sub">🔒 Locked</div>
    </div>
  </div>

  <div class="safety">
    <div class="safety-title">🛡️ SAFETY CHECKS</div>
    <div class="safety-checks">
      <div class="safety-check"><div class="check-dot">✓</div> LP locked</div>
      <div class="safety-check"><div class="check-dot">✓</div> Mint renounced</div>
      <div class="safety-check"><div class="check-dot">✓</div> No mint auth</div>
      <div class="safety-check"><div class="check-dot">✓</div> Top 10: 18%</div>
    </div>
  </div>

  <div class="socials">
    <div class="socials-row">
      <a class="social"><span class="social-icon">𝕏</span><div class="social-label">Twitter</div><div class="social-count">12.4K</div></a>
      <a class="social"><span class="social-icon">✈️</span><div class="social-label">Telegram</div><div class="social-count">3.2K</div></a>
      <a class="social"><span class="social-icon">🌐</span><div class="social-label">Web</div><div class="social-count">↗</div></a>
      <a class="social"><span class="social-icon">📊</span><div class="social-label">Chart</div><div class="social-count">↗</div></a>
    </div>
  </div>

  <div class="feed">
    <div class="feed-tabs">
      <div class="feed-tab active">LIVE TRADES</div>
      <div class="feed-tab">TOP HOLDERS</div>
    </div>
    <div class="feed-list">
      <div class="feed-item">
        <div class="feed-side buy">BUY</div>
        <div class="feed-mid">
          <div class="feed-amount">2.4M HOPPY</div>
          <div class="feed-wallet">7xKn...e4Pq</div>
        </div>
        <div class="feed-right">
          <div class="feed-value" style="color: var(--green);">+$100.42</div>
          <div class="feed-time">2s ago</div>
        </div>
      </div>
      <div class="feed-item">
        <div class="feed-side buy">BUY</div>
        <div class="feed-mid">
          <div class="feed-amount">580K HOPPY</div>
          <div class="feed-wallet">Bp3a...M9zX</div>
        </div>
        <div class="feed-right">
          <div class="feed-value" style="color: var(--green);">+$24.18</div>
          <div class="feed-time">8s ago</div>
        </div>
      </div>
      <div class="feed-item">
        <div class="feed-side sell">SELL</div>
        <div class="feed-mid">
          <div class="feed-amount">1.1M HOPPY</div>
          <div class="feed-wallet">Fr8m...kT2N</div>
        </div>
        <div class="feed-right">
          <div class="feed-value" style="color: var(--red);">-$45.92</div>
          <div class="feed-time">14s ago</div>
        </div>
      </div>
      <div class="feed-item">
        <div class="feed-side buy">BUY</div>
        <div class="feed-mid">
          <div class="feed-amount">12.5M HOPPY</div>
          <div class="feed-wallet">Hg2c...wQ8L</div>
        </div>
        <div class="feed-right">
          <div class="feed-value" style="color: var(--green);">+$522.30</div>
          <div class="feed-time">22s ago</div>
        </div>
      </div>
    </div>
  </div>

  <div class="contract">
    <div class="contract-info">
      <div class="contract-label">Contract</div>
      <div class="contract-addr">HoP7sQ2k...8eRfNXcM</div>
    </div>
    <button class="copy-btn">COPY</button>
  </div>
</div>

<!-- =================== TRADE SHEET =================== -->
<div class="sheet-backdrop" id="sheetBackdrop" onclick="closeSheet()"></div>
<div class="sheet" id="sheet">
  <div class="grabber"></div>

  <div class="sheet-token-head">
    <div class="sheet-emoji" id="sheetEmoji">🐸</div>
    <div class="sheet-token-info">
      <div class="sheet-token-name" id="sheetName">HOPPY</div>
      <div class="sheet-sub">
        <span class="change-pill" id="sheetChange">📈 +247%</span>
        <span class="age-pill" id="sheetAge">3D OLD</span>
      </div>
    </div>
    <button class="icon-btn" onclick="closeSheet()">×</button>
  </div>

  <div class="tab-switch" id="tabSwitch">
    <div class="tab-indicator"></div>
    <div class="tab active" data-tab="buy">BUY</div>
    <div class="tab" data-tab="sell">SELL</div>
  </div>

  <div class="amount-section">
    <div class="amount-label">
      <span>You Pay</span>
      <span class="balance">Balance <b>0.0382 SOL</b></span>
    </div>
    <div class="amount-input-wrap">
      <input class="amount-input" id="amount" type="text" inputmode="decimal" value="0.50" />
      <div class="currency">
        <div class="currency-icon"></div>
        SOL
      </div>
    </div>
    <div class="usd-value" id="usdValue">≈ $42.57</div>

    <div class="presets" id="presets">
      <button class="preset" data-amt="0.1">0.1</button>
      <button class="preset selected" data-amt="0.5">0.5</button>
      <button class="preset" data-amt="1">1</button>
      <button class="preset" data-amt="MAX">MAX</button>
    </div>
  </div>

  <div class="receive">
    <div>
      <div class="receive-label">You Get</div>
      <div class="receive-amount" id="receiveAmount">1,178,294 HOPPY</div>
    </div>
    <div class="receive-rate">Rate<br><b>1 SOL = 2.36M</b></div>
  </div>

  <div class="cta-wrap">
    <button class="cta" id="ctaBtn" onclick="confirmTrade()">🚀 APE INTO HOPPY</button>
    <div class="trust">Powered by <span class="jup-badge"><span class="jup-dot"></span><b>JUPITER</b></span> · Non-custodial 🔐</div>
  </div>
</div>

<!-- =================== SUCCESS OVERLAY =================== -->
<div class="success-overlay" id="successOverlay">
  <div class="confetti-rain" id="confettiRain"></div>

  <div class="success-top">
    <button class="icon-btn" onclick="closeSuccess()">×</button>
    <button class="view-on">VIEW ON SOLSCAN ↗</button>
  </div>

  <div class="success">
    <div class="success-emoji">🎉</div>
    <div class="success-title">YOU APED!</div>
    <div class="success-sub" id="successSub">Welcome to the HOPPY chat, anon 🐸</div>
  </div>

  <div class="flex-card">
    <div class="flex-top">
      <div class="flex-emoji" id="flexEmoji">🐸</div>
      <div class="flex-token">
        <div class="flex-sym" id="flexSym">$HOPPY</div>
        <div class="flex-tag">Hoppy The Frog · <b>+247% 24h</b></div>
      </div>
    </div>
    <div class="flex-row"><span class="flex-label">You paid</span><span class="flex-value">0.50 SOL</span></div>
    <div class="flex-row"><span class="flex-label">Bag size</span><span class="flex-value big">1.18M</span></div>
    <div class="flex-divider"></div>
    <div class="flex-row"><span class="flex-label">Entry</span><span class="flex-value" style="font-size: 13px;">$0.0000418</span></div>
    <div class="flex-watermark">VIA <b>NEXUS</b></div>
  </div>

  <div class="share-section">
    <div class="share-title">FLEX YOUR BAG 💪</div>
    <div class="share-sub">Earn <b>20%</b> of fees from anyone who apes with your link</div>
    <div class="share-grid">
      <a class="share-btn" style="--share-bg: #000; --share-color: #fff;"><div class="share-icon">𝕏</div><div class="share-label">Post on X</div></a>
      <a class="share-btn" style="--share-bg: #229ED9; --share-color: #fff;"><div class="share-icon">✈</div><div class="share-label">Telegram</div></a>
      <a class="share-btn" style="--share-bg: rgba(77,255,210,0.18); --share-color: #4dffd2;"><div class="share-icon">🔗</div><div class="share-label">Copy Link</div></a>
      <a class="share-btn" style="--share-bg: rgba(255,225,77,0.18); --share-color: #ffe14d;"><div class="share-icon">⬇</div><div class="share-label">Save Card</div></a>
    </div>
  </div>

  <div class="refer">
    <div class="refer-row">
      <div class="refer-emoji">💰</div>
      <div class="refer-text">
        <div class="refer-title">YOUR REFERRAL LINK</div>
        <div class="refer-sub">Earn 20% of every swap fee — forever</div>
      </div>
    </div>
    <div class="refer-link">
      <span class="refer-url">nexus.app/t/<span id="refToken">hoppy</span>?ref=<b>Dd6bKf</b></span>
      <button class="refer-copy">COPY</button>
    </div>
  </div>

  <div class="done-wrap">
    <button class="done-btn" onclick="closeSuccess()">🚀 BACK TO WONDERLAND</button>
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

<script>
  // ===== TOKEN DATA =====
  const TOKENS = {
    hoppy:  { emoji: '🐸', sym: 'HOPPY',    full: 'Hoppy The Frog · Solana', price: '$0.0000418', change: '+247%', age: '3D OLD', tokensPer: 2356588 },
    fart:   { emoji: '💨', sym: 'FARTCOIN', full: 'Fartcoin · Solana',        price: '$0.0000218', change: '+412%', age: '1D OLD', tokensPer: 4521000 },
    chonk:  { emoji: '🐱', sym: 'CHONK',    full: 'Chonky Cat · Solana',      price: '$0.0001124', change: '+68%',  age: '12H OLD', tokensPer: 876000 },
    pepe:   { emoji: '🐸', sym: 'PEPE',     full: 'Pepe · Solana',            price: '$0.0000089', change: '+18.4%',age: '2Y OLD', tokensPer: 11000000 },
    wif:    { emoji: '🐶', sym: 'WIF',      full: 'dogwifhat · Solana',       price: '$2.42',      change: '+9.1%', age: '1Y OLD', tokensPer: 40.5 },
    bonk:   { emoji: '🐕', sym: 'BONK',     full: 'Bonk · Solana',            price: '$0.0000412', change: '-2.8%', age: '2Y OLD', tokensPer: 2400000 },
    mog:    { emoji: '😼', sym: 'MOGCAT',   full: 'Mog Cat · Solana',         price: '$0.0000031', change: '+89%',  age: '2H OLD', tokensPer: 31800000 },
    cards:  { emoji: '🎴', sym: 'CARDS',    full: 'CARDS · Solana',           price: '$0.1765',    change: '+5.83%',age: '45D OLD', tokensPer: 555 }
  };

  let currentToken = 'hoppy';
  let mode = 'buy';
  const SOL_PRICE = 85.14;

  // ===== CARD CLICK = DETAIL =====
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', (e) => {
      // only open detail if not clicking buy/sell mini-btns
      if (e.target.closest('.mini-btn')) return;
      openDetail(card.dataset.token);
    });
  });

  function openDetail(token) {
    const t = TOKENS[token];
    currentToken = token;
    document.getElementById('detailEmoji').textContent = t.emoji;
    document.getElementById('detailName').textContent = t.sym;
    document.getElementById('detailFullname').textContent = t.full;
    document.getElementById('detailPrice').textContent = t.price;
    document.getElementById('detailTitle').innerHTML = '$' + t.sym + ' <span class="check-mint">✓</span>';
    const changeIsDown = t.change.startsWith('-');
    document.getElementById('detailChange').innerHTML = (changeIsDown ? '📉 ' : '📈 ') + t.change;
    document.getElementById('detailChange').style.background = changeIsDown
      ? 'linear-gradient(135deg, var(--pink), var(--red))'
      : 'linear-gradient(135deg, var(--green), var(--mint))';
    document.getElementById('detailChange').style.color = changeIsDown ? '#fff' : '#0a0815';
    document.getElementById('detailOverlay').classList.add('show');
    document.getElementById('detailOverlay').scrollTop = 0;
  }

  function closeDetail() {
    document.getElementById('detailOverlay').classList.remove('show');
  }

  // ===== SHEET =====
  function openSheet(e, token, m) {
    if (e) { e.stopPropagation(); }
    currentToken = token;
    mode = m;
    const t = TOKENS[token];
    document.getElementById('sheetEmoji').textContent = t.emoji;
    document.getElementById('sheetName').textContent = t.sym;
    document.getElementById('sheetAge').textContent = t.age;
    const isDown = t.change.startsWith('-');
    document.getElementById('sheetChange').innerHTML = (isDown ? '📉 ' : '📈 ') + t.change;
    document.getElementById('sheetChange').style.background = isDown
      ? 'linear-gradient(135deg, var(--pink), var(--red))'
      : 'linear-gradient(135deg, var(--green), var(--mint))';
    document.getElementById('sheetChange').style.color = isDown ? '#fff' : '#0a0815';
    setMode(m);
    update();
    document.getElementById('sheetBackdrop').classList.add('show');
    document.getElementById('sheet').classList.add('show');
  }

  function openSheetFromDetail(m) {
    openSheet(null, currentToken, m);
  }

  function closeSheet() {
    document.getElementById('sheetBackdrop').classList.remove('show');
    document.getElementById('sheet').classList.remove('show');
  }

  function setMode(m) {
    mode = m;
    const ts = document.getElementById('tabSwitch');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === m));
    ts.classList.toggle('sell-mode', m === 'sell');
    const cta = document.getElementById('ctaBtn');
    const sym = TOKENS[currentToken].sym;
    if (m === 'sell') {
      cta.textContent = '💸 DUMP ' + sym;
      cta.classList.add('sell-cta');
    } else {
      cta.textContent = '🚀 APE INTO ' + sym;
      cta.classList.remove('sell-cta');
    }
  }

  function format(n) {
    if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return Math.round(n).toLocaleString();
    return n.toFixed(2);
  }

  function update() {
    const a = parseFloat(document.getElementById('amount').value) || 0;
    document.getElementById('usdValue').textContent = '≈ $' + (a * SOL_PRICE).toFixed(2);
    const t = TOKENS[currentToken];
    if (mode === 'buy') {
      document.getElementById('receiveAmount').textContent = format(a * t.tokensPer) + ' ' + t.sym;
    } else {
      document.getElementById('receiveAmount').textContent = (a / t.tokensPer * SOL_PRICE).toFixed(4) + ' SOL';
    }
  }

  document.getElementById('amount').addEventListener('input', () => {
    document.querySelectorAll('.preset').forEach(p => p.classList.remove('selected'));
    update();
  });

  document.getElementById('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset');
    if (!btn) return;
    document.querySelectorAll('.preset').forEach(p => p.classList.remove('selected'));
    btn.classList.add('selected');
    const amt = btn.dataset.amt;
    document.getElementById('amount').value = amt === 'MAX' ? '0.0382' : amt;
    update();
  });

  document.getElementById('tabSwitch').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    setMode(tab.dataset.tab);
    update();
  });

  // ===== CONFIRM = SUCCESS =====
  function confirmTrade() {
    const t = TOKENS[currentToken];
    const a = parseFloat(document.getElementById('amount').value) || 0;
    const got = format(a * t.tokensPer);
    document.getElementById('flexEmoji').textContent = t.emoji;
    document.getElementById('flexSym').textContent = '$' + t.sym;
    document.getElementById('successSub').textContent = 'Welcome to the ' + t.sym + ' chat, anon ' + t.emoji;
    document.getElementById('refToken').textContent = currentToken;
    document.querySelectorAll('.flex-row .flex-value')[0].textContent = a.toFixed(2) + ' SOL';
    document.querySelectorAll('.flex-row .flex-value')[1].textContent = got;
    document.querySelectorAll('.flex-row .flex-value')[2].textContent = t.price;
    closeSheet();
    closeDetail();
    document.getElementById('successOverlay').classList.add('show');
    document.getElementById('successOverlay').scrollTop = 0;
    spawnConfetti();
  }

  function closeSuccess() {
    document.getElementById('successOverlay').classList.remove('show');
    document.getElementById('confettiRain').innerHTML = '';
  }

  function spawnConfetti() {
    const emojis = ['🎉','🚀','💎','🐸','✨','🍭','💸','⭐','🌈'];
    const container = document.getElementById('confettiRain');
    container.innerHTML = '';
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (3 + Math.random() * 3) + 's';
      p.style.animationDelay = Math.random() * 1.5 + 's';
      p.style.fontSize = (16 + Math.random() * 14) + 'px';
      container.appendChild(p);
    }
  }

  // chart tf + feed tab toggles
  document.querySelectorAll('.tf').forEach(tf => tf.addEventListener('click', () => {
    document.querySelectorAll('.tf').forEach(t => t.classList.remove('active'));
    tf.classList.add('active');
  }));
  document.querySelectorAll('.feed-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  }));
  // filter chips
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
  }));
</script>
</body>
</html>
