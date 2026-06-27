<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Discover · Solana</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0b0f; --panel:#111319; --panel-2:#171a22; --raise:#1c2029;
  --line:#222632; --hair:#181b22;
  --ink:#f3f4f7; --ink-2:#878e9e; --ink-3:#555b68;
  --up:#1ad98b; --up-soft:rgba(26,217,139,.13);
  --down:#ff5d6a; --down-soft:rgba(255,93,106,.13);
  --sol:#9b5cff; --sol-soft:rgba(155,92,255,.16);
  --grad:linear-gradient(135deg,#9b5cff,#14f195);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;display:flex;justify-content:center;min-height:100vh}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.app{width:100%;max-width:448px;min-height:100vh;background:var(--bg);
  border-left:1px solid var(--hair);border-right:1px solid var(--hair);position:relative}
[hidden]{display:none!important}

/* header */
.top{position:sticky;top:0;z-index:30;background:rgba(10,11,15,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--hair)}
.top-bar{display:flex;align-items:center;gap:11px;padding:13px 16px 11px}
.mark{width:26px;height:26px;border-radius:8px;background:var(--grad);position:relative;flex-shrink:0}
.mark::after{content:"";position:absolute;inset:7px;border-radius:3px;background:var(--bg)}
.wordmark{font-weight:800;font-size:16px;letter-spacing:-.02em}
.wordmark span{color:var(--ink-3);font-weight:600}
.top-spacer{flex:1}
.icon-btn{width:34px;height:34px;border-radius:10px;background:var(--panel);border:1px solid var(--line);
  display:grid;place-items:center;color:var(--ink-2);cursor:pointer}
.search{display:flex;align-items:center;gap:9px;margin:0 16px 12px;background:var(--panel);
  border:1px solid var(--line);border-radius:12px;padding:10px 13px;transition:border-color .15s}
.search:focus-within{border-color:var(--sol)}
.search svg{color:var(--ink-3);flex-shrink:0}
.search input{flex:1;min-width:0;border:none;background:none;outline:none;color:var(--ink);font-family:inherit;font-size:13.5px;font-weight:500}
.search input::placeholder{color:var(--ink-3)}

/* primary view switch */
.viewseg{display:flex;gap:6px;padding:0 16px 12px}
.viewseg button{flex:1;border:1px solid var(--line);background:var(--panel);cursor:pointer;font-family:inherit;
  font-weight:800;font-size:13px;color:var(--ink-2);padding:10px;border-radius:12px;letter-spacing:-.01em;
  display:flex;align-items:center;justify-content:center;gap:7px;transition:all .14s}
.viewseg button .vd{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.55}
.viewseg button.on{color:var(--ink);border-color:transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,var(--grad) border-box}
.viewseg button.on .vd{opacity:1;background:var(--up)}

/* tabs (discover) */
.tabs{display:flex;gap:4px;padding:0 12px 2px;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;border:none;background:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:13.5px;
  color:var(--ink-3);padding:9px 12px;position:relative;transition:color .15s}
.tab.on{color:var(--ink)}
.tab.on::after{content:"";position:absolute;left:12px;right:12px;bottom:0;height:2px;border-radius:2px;background:var(--grad)}

/* controls shared */
.controls{padding:11px 16px 4px;border-bottom:1px solid var(--hair)}
.ctrl-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.seg{display:inline-flex;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:3px;flex-wrap:wrap}
.seg button{border:none;background:none;cursor:pointer;font-family:"JetBrains Mono",monospace;font-weight:700;
  font-size:11.5px;color:var(--ink-2);padding:6px 11px;border-radius:7px;transition:all .12s;white-space:nowrap}
.seg button.on{background:var(--raise);color:var(--ink)}
.sortwrap{margin-left:auto;display:flex;align-items:center;gap:6px}
.select{position:relative}
select{appearance:none;-webkit-appearance:none;background:var(--panel);border:1px solid var(--line);color:var(--ink);
  font-family:inherit;font-weight:700;font-size:12.5px;border-radius:10px;padding:8px 28px 8px 12px;cursor:pointer}
.select::after{content:"▾";position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--ink-3);font-size:10px;pointer-events:none}
.dir{width:34px;height:34px;flex-shrink:0;border-radius:10px;background:var(--panel);border:1px solid var(--line);
  color:var(--ink);cursor:pointer;font-size:14px;font-weight:700;display:grid;place-items:center}
.chips{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding-bottom:11px}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--panel);cursor:pointer;font-family:inherit;
  font-weight:700;font-size:12px;color:var(--ink-2);padding:7px 12px;border-radius:999px;display:inline-flex;
  align-items:center;gap:6px;transition:all .12s;white-space:nowrap}
.chip:hover{border-color:var(--raise)}
.chip.on{background:var(--sol-soft);border-color:var(--sol);color:#cdb6ff}
.chip .dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7}
.filters-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;
  cursor:pointer;font-family:inherit;color:var(--ink-2);font-weight:700;font-size:12.5px;padding:2px 0 12px}
.filters-toggle .fcount{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--sol);color:#0a0b0f;font-family:"JetBrains Mono",monospace;font-size:10px;margin-left:7px}
.filters-toggle .chev{transition:transform .2s}
.filters-toggle.open .chev{transform:rotate(180deg)}
.adv{overflow:hidden;max-height:0;transition:max-height .28s ease}
.adv.open{max-height:560px}
.adv-inner{padding:4px 0 14px;border-top:1px solid var(--hair)}
.adv-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-family:"JetBrains Mono",monospace;font-size:9.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--ink-3)}
.field input,.field .selwrap select{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--ink);
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:500;padding:9px 11px;outline:none}
.field input:focus{border-color:var(--sol)}
.field input::placeholder{color:var(--ink-3)}
.field .selwrap{position:relative}
.field .selwrap select{appearance:none;-webkit-appearance:none;padding-right:26px;cursor:pointer}
.field .selwrap::after{content:"▾";position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--ink-3);font-size:9px;pointer-events:none}
.toggles{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.toggle{border:1px solid var(--line);background:var(--panel);cursor:pointer;font-family:inherit;font-weight:700;
  font-size:11.5px;color:var(--ink-2);padding:7px 11px;border-radius:9px;transition:all .12s}
.toggle.on{background:var(--up-soft);border-color:var(--up);color:#7df0c0}
.adv-actions{display:flex;gap:8px;margin-top:14px}
.btn-reset{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--ink-2);cursor:pointer;font-family:inherit;font-weight:700;font-size:12.5px;padding:11px;border-radius:11px}
.btn-apply{flex:1.6;background:var(--sol);border:none;color:#0a0b0f;cursor:pointer;font-family:inherit;font-weight:800;font-size:12.5px;padding:11px;border-radius:11px}

/* lanes (launches) */
.lanes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.lane{border:1px solid var(--line);background:var(--panel);cursor:pointer;font-family:inherit;font-weight:800;font-size:13px;
  color:var(--ink-2);padding:11px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:7px;transition:all .14s}
.lane .lc{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;background:var(--raise);color:var(--ink-2);padding:2px 7px;border-radius:999px}
.lane.on{color:var(--ink);border-color:var(--sol);background:var(--sol-soft)}
.lane.on .lc{background:rgba(155,92,255,.3);color:#e6d8ff}

/* results */
.res-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 7px}
.res-count{font-family:"JetBrains Mono",monospace;font-size:11.5px;font-weight:700;color:var(--ink-2)}
.res-count b{color:var(--ink)}
.res-note{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);letter-spacing:.4px}

/* discover rows */
.toklist{padding:0 10px 28px;display:flex;flex-direction:column;gap:7px}
.tok{display:flex;align-items:center;gap:11px;background:var(--panel);border:1px solid var(--hair);border-radius:14px;
  padding:11px 12px;cursor:pointer;transition:border-color .12s,transform .1s}
.tok:hover{border-color:var(--line);transform:translateY(-1px)}
.logo{width:40px;height:40px;border-radius:11px;flex-shrink:0;display:grid;place-items:center;font-weight:800;
  font-size:14px;color:#fff;letter-spacing:-.03em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.mid{flex:1;min-width:0}
.row1{display:flex;align-items:center;gap:6px;min-width:0}
.sym{font-weight:800;font-size:15px;letter-spacing:-.01em;flex-shrink:0}
.name{font-size:12px;color:var(--ink-3);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp{flex-shrink:0;font-family:"JetBrains Mono",monospace;font-size:8.5px;font-weight:700;letter-spacing:.3px;padding:2px 5px;border-radius:5px;text-transform:uppercase}
.lp.pump{background:rgba(26,217,139,.12);color:#1ad98b}
.lp.ray{background:rgba(155,92,255,.14);color:#b690ff}
.lp.moon{background:rgba(255,176,52,.14);color:#ffc46b}
.verified{flex-shrink:0;color:var(--sol);font-size:11px}
.row2{display:flex;align-items:center;gap:8px;margin-top:5px;font-family:"JetBrains Mono",monospace;font-size:10.5px;
  color:var(--ink-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row2 .k{color:var(--ink-3)}
.row2 .sep{color:var(--line)}
.gradbar{height:3px;border-radius:2px;background:var(--raise);margin-top:7px;overflow:hidden;max-width:150px}
.gradbar i{display:block;height:100%;background:var(--grad);border-radius:2px}
.right{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0}
.price{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:14px;letter-spacing:-.02em}
.chg{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:11.5px;padding:2px 6px;border-radius:6px}
.chg.up{color:var(--up);background:var(--up-soft)}
.chg.down{color:var(--down);background:var(--down-soft)}
.buy{flex-shrink:0;border:none;cursor:pointer;background:var(--up);color:#04140d;font-family:inherit;font-weight:800;
  font-size:12.5px;padding:9px 14px;border-radius:11px;transition:filter .12s,transform .1s}
.buy:hover{filter:brightness(1.08);transform:translateY(-1px)}

/* launch feed */
.launchfeed{padding:0 12px 28px;display:flex;flex-direction:column;gap:10px}
.spotlight{border-radius:16px;padding:1px;background:var(--grad);margin-bottom:2px}
.spotlight-in{background:var(--panel);border-radius:15px;padding:13px}
.spot-tag{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;letter-spacing:1.2px;color:var(--up);margin-bottom:9px}
.lcard{background:var(--panel);border:1px solid var(--hair);border-radius:16px;padding:13px;transition:border-color .14s,transform .1s}
.lcard:hover{border-color:var(--line);transform:translateY(-1px)}
.lhead{display:flex;align-items:center;gap:11px}
.lavatar{width:42px;height:42px;border-radius:13px;flex-shrink:0;display:grid;place-items:center;font-weight:800;
  font-size:15px;color:#fff;letter-spacing:-.03em;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.linfo{flex:1;min-width:0}
.lsym-row{display:flex;align-items:center;gap:7px}
.lsym{font-weight:800;font-size:17px;letter-spacing:-.01em}
.agepill{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;letter-spacing:.3px;padding:2px 7px;
  border-radius:6px;background:var(--raise);color:var(--ink-2);text-transform:uppercase}
.agepill.fresh{background:var(--up-soft);color:var(--up)}
.lname{font-size:12px;color:var(--ink-3);font-weight:500;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lright{text-align:right;flex-shrink:0}
.lprice{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:14px;letter-spacing:-.02em}
.lchg{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:11px;margin-top:3px}
.lspark{height:34px;margin:11px 0 0}
.lspark svg{width:100%;height:100%;display:block}
.lmetrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:11px;padding:10px 6px;border-radius:12px;background:var(--panel-2);border:1px solid var(--hair)}
.lmetric{text-align:center;min-width:0}
.lmetric .k{font-family:"JetBrains Mono",monospace;font-size:8px;color:var(--ink-3);letter-spacing:.6px;text-transform:uppercase;font-weight:700}
.lmetric .v{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:12.5px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmetric .v.sig{color:var(--up)}
.lbadges{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.lbadge{font-family:"JetBrains Mono",monospace;font-size:9.5px;font-weight:700;letter-spacing:.2px;padding:4px 8px;border-radius:7px;
  background:var(--panel-2);border:1px solid var(--line);color:var(--ink-2)}
.lbadge.good{background:var(--up-soft);border-color:rgba(26,217,139,.3);color:#7df0c0}
.lbadge.warn{background:rgba(255,176,52,.1);border-color:rgba(255,176,52,.3);color:#ffc46b}
.lactions{display:flex;gap:8px;margin-top:12px}
.lbuy{flex:1.5;border:none;cursor:pointer;background:var(--up);color:#04140d;font-family:inherit;font-weight:800;font-size:13.5px;padding:11px;border-radius:12px;transition:filter .12s,transform .1s}
.lbuy:hover{filter:brightness(1.08);transform:translateY(-1px)}
.lsell{flex:1;border:1px solid var(--line);cursor:pointer;background:var(--panel);color:var(--ink);font-family:inherit;font-weight:700;font-size:13.5px;padding:11px;border-radius:12px;transition:border-color .12s}
.lsell:hover{border-color:var(--ink-3)}

.empty{text-align:center;padding:40px 24px;color:var(--ink-2);font-size:13px;font-weight:500}
.empty b{color:var(--ink);font-weight:700;display:block;margin-bottom:5px}
</style>
</head>
<body>
<div class="app">

  <div class="top">
    <div class="top-bar">
      <div class="mark"></div>
      <div class="wordmark">discover <span>/ solana</span></div>
      <div class="top-spacer"></div>
      <div class="icon-btn" title="Settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </div>
    </div>
    <div class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="q" placeholder="Search ticker, name, or contract" />
    </div>
    <div class="viewseg" id="viewseg">
      <button data-view="discover" class="on"><span class="vd"></span>Discover</button>
      <button data-view="launches"><span class="vd"></span>Launches</button>
    </div>
  </div>

  <!-- DISCOVER CONTROLS -->
  <div id="discoverControls">
    <div class="tabs" id="tabs">
      <button class="tab" data-tab="new">New</button>
      <button class="tab on" data-tab="trending">Trending</button>
      <button class="tab" data-tab="surging">Surging</button>
      <button class="tab" data-tab="graduating">Graduating</button>
      <button class="tab" data-tab="top">Top</button>
    </div>
    <div class="controls">
      <div class="ctrl-row">
        <div class="seg" id="tf">
          <button data-tf="m5">5m</button><button data-tf="h1">1h</button>
          <button data-tf="h6">6h</button><button data-tf="h24" class="on">24h</button>
        </div>
        <div class="sortwrap">
          <div class="select">
            <select id="sort">
              <option value="vol">Volume</option><option value="mc">Market cap</option>
              <option value="liq">Liquidity</option><option value="holders">Holders</option>
              <option value="age">Age</option><option value="chg">Change</option>
            </select>
          </div>
          <button class="dir" id="dir" title="Sort direction">↓</button>
        </div>
      </div>
      <div class="chips" id="chips">
        <button class="chip" data-chip="trending"><span class="dot"></span>Trending</button>
        <button class="chip" data-chip="pumpfun">Pump.fun</button>
        <button class="chip" data-chip="raydium">Raydium</button>
        <button class="chip" data-chip="moonshot">Moonshot</button>
        <button class="chip" data-chip="verified">Verified</button>
        <button class="chip" data-chip="socials">Has socials</button>
      </div>
      <button class="filters-toggle" id="filtersToggle">
        <span>Advanced filters <span class="fcount" id="fcount">0</span></span>
        <span class="chev">▾</span>
      </button>
      <div class="adv" id="adv">
        <div class="adv-inner">
          <div class="adv-grid">
            <div class="field"><label>Min market cap</label><input id="mcMin" inputmode="decimal" placeholder="e.g. 100K" /></div>
            <div class="field"><label>Max market cap</label><input id="mcMax" inputmode="decimal" placeholder="any" /></div>
            <div class="field"><label>Min liquidity</label><input id="liqMin" inputmode="decimal" placeholder="e.g. 20K" /></div>
            <div class="field"><label>Min 24h volume</label><input id="volMin" inputmode="decimal" placeholder="e.g. 50K" /></div>
            <div class="field"><label>Min holders</label><input id="holdersMin" inputmode="numeric" placeholder="e.g. 500" /></div>
            <div class="field"><label>Max age</label><div class="selwrap"><select id="ageMax">
              <option value="any">Any</option><option value="60">Under 1h</option><option value="360">Under 6h</option>
              <option value="1440">Under 24h</option><option value="10080">Under 7d</option>
            </select></div></div>
          </div>
          <div class="toggles" id="toggles">
            <button class="toggle" data-tg="lpBurned">LP burned</button>
            <button class="toggle" data-tg="mintRevoked">Mint revoked</button>
            <button class="toggle" data-tg="freezeRevoked">Freeze revoked</button>
            <button class="toggle" data-tg="hideLowLiq">Hide low liq</button>
          </div>
          <div class="adv-actions">
            <button class="btn-reset" id="reset">Reset all</button>
            <button class="btn-apply" id="apply">Show results</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- LAUNCHES CONTROLS -->
  <div id="launchControls" hidden>
    <div class="controls">
      <div class="lanes" id="lanes">
        <button class="lane on" data-lane="hatched">Just hatched <span class="lc" id="lcHatched">0</span></button>
        <button class="lane" data-lane="radar">On radar <span class="lc" id="lcRadar">0</span></button>
      </div>
      <div class="ctrl-row">
        <div class="seg" id="lf">
          <button data-lf="all" class="on">All</button><button data-lf="60">Still hot</button>
          <button data-lf="360">Today</button><button data-lf="1440">24h</button>
        </div>
        <div class="sortwrap">
          <div class="select">
            <select id="lsort">
              <option value="newest">Freshest</option><option value="volume">Loudest</option><option value="signal">Top signal</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="res-head">
    <div class="res-count"><b id="count">—</b> <span id="countNoun">tokens</span></div>
    <div class="res-note" id="note">SORTED BY VOLUME · 24H</div>
  </div>

  <div class="toklist" id="toklist"></div>
  <div class="launchfeed" id="launchfeed" hidden></div>

</div>

<script>
/* ── sparkline ─────────────────────────────────────────── */
function rng(seed){let s=seed%2147483647;if(s<=0)s+=2147483646;return()=>(s=s*16807%2147483647)/2147483647;}
function sparkSvg({seed=1,up=true,w=300,h=34,pts=26}={}){
  const r=rng(seed),data=[];let v=0.5;const drift=(up?1:-1)*0.02;
  for(let i=0;i<pts;i++){v+=drift+(r()-0.5)*0.15;v=Math.max(0.08,Math.min(0.92,v));data.push(v);}
  const pad=4,iw=w,ih=h-pad*2,X=i=>(i/(pts-1))*iw,Y=val=>pad+(1-val)*ih;
  let d="M"+X(0).toFixed(1)+" "+Y(data[0]).toFixed(1);
  for(let i=1;i<pts;i++){const xm=(X(i-1)+X(i))/2;
    d+=" C"+xm.toFixed(1)+" "+Y(data[i-1]).toFixed(1)+" "+xm.toFixed(1)+" "+Y(data[i]).toFixed(1)+" "+X(i).toFixed(1)+" "+Y(data[i]).toFixed(1);}
  const col=up?"#1ad98b":"#ff5d6a",gid="g"+seed+(up?"u":"d");
  const area=d+" L"+X(pts-1).toFixed(1)+" "+h+" L0 "+h+" Z";
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+
    '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+col+'" stop-opacity="0.24"/><stop offset="1" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#'+gid+')"/><path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
    '<circle cx="'+X(pts-1).toFixed(1)+'" cy="'+Y(data[pts-1]).toFixed(1)+'" r="2.3" fill="'+col+'"/></svg>';
}

/* ── discover data ─────────────────────────────────────── */
function mk(sym,name,lp,grad,age,price,mc,liq,vol,holders,chg,a,gradPct){
  return {sym,name,lp,gradient:grad,age,price,mc,liq,vol,holders,chg,
    verified:!!a.v,socials:!!a.s,lpBurned:!!a.lp,mintRevoked:!!a.mt,freezeRevoked:!!a.fz,trending:!!a.tr,gradPct};
}
const T=[
  mk("WIF","dogwifhat","ray","linear-gradient(150deg,#c98a4b,#7a4f23)",1036800,2.84,2.8e9,4.2e7,1.8e8,210000,{m5:0.4,h1:1.2,h6:3.1,h24:6.2},{v:1,s:1,lp:1,mt:1,fz:1,tr:1},null),
  mk("BONK","Bonk","ray","linear-gradient(150deg,#f5a524,#c8780a)",1584000,0.0000312,2.1e9,3.1e7,1.4e8,720000,{m5:1.1,h1:2.4,h6:5.0,h24:11.4},{v:1,s:1,lp:1,mt:1,fz:1,tr:1},null),
  mk("POPCAT","Popcat","ray","linear-gradient(150deg,#e8c39a,#a87a4d)",576000,1.07,1.0e9,2.0e7,6.0e7,95000,{m5:-0.3,h1:-1.0,h6:-2.2,h24:-3.1},{v:1,s:1,lp:1,mt:1,fz:1,tr:0},null),
  mk("PNUT","Peanut the Squirrel","ray","linear-gradient(150deg,#d4823a,#8a4f1e)",331200,1.42,1.4e9,2.5e7,1.24e8,48000,{m5:2.6,h1:7.4,h6:18.0,h24:38.6},{v:1,s:1,lp:1,mt:1,fz:1,tr:1},null),
  mk("GIGA","Gigachad","ray","linear-gradient(150deg,#8a8f99,#3a3f4a)",288000,0.041,4.1e8,1.1e7,3.0e7,30000,{m5:1.8,h1:5.1,h6:12.4,h24:22.7},{v:1,s:1,lp:1,mt:1,fz:1,tr:1},null),
  mk("MOODENG","Moo Deng","ray","linear-gradient(150deg,#f0a0b8,#b85a78)",345600,0.21,2.08e8,8.0e6,2.0e7,22000,{m5:-1.2,h1:-3.0,h6:-5.5,h24:-7.4},{v:1,s:1,lp:1,mt:1,fz:1,tr:0},null),
  mk("GOAT","Goatseus Maximus","ray","linear-gradient(150deg,#5a7d4a,#2e4226)",331200,0.58,5.4e8,1.3e7,2.2e7,26000,{m5:-0.4,h1:-0.9,h6:-1.3,h24:-1.8},{v:1,s:1,lp:1,mt:1,fz:1,tr:0},null),
  mk("MICHI","Michi","ray","linear-gradient(150deg,#e0c060,#9a7e2a)",374400,0.18,1.7e8,6.0e6,9.0e6,12000,{m5:0.9,h1:2.6,h6:5.4,h24:9.0},{v:0,s:1,lp:1,mt:1,fz:0,tr:0},null),
  mk("FWOG","Fwog","pump","linear-gradient(150deg,#6fae5a,#2f5e28)",302400,0.33,3.3e8,9.0e6,1.5e7,18000,{m5:0.6,h1:1.9,h6:4.7,h24:9.9},{v:1,s:1,lp:1,mt:1,fz:1,tr:0},null),
  mk("ZAPCAT","Zap Cat","pump","linear-gradient(150deg,#9b5cff,#5a2fae)",38,0.0021,210000,64000,340000,1240,{m5:14,h1:52,h6:88,h24:88},{v:0,s:1,lp:1,mt:1,fz:1,tr:1},88),
  mk("DREAMR","Dreamer","pump","linear-gradient(150deg,#4aa3d4,#235a7a)",14,0.0009,92000,38000,120000,810,{m5:9,h1:24,h6:64,h24:64},{v:0,s:1,lp:0,mt:1,fz:1,tr:0},64),
  mk("WAGMI","We All Gonna Make It","pump","linear-gradient(150deg,#e0606a,#8a2e36)",51,0.0014,140000,31000,98000,560,{m5:6,h1:12,h6:12,h24:12},{v:0,s:1,lp:0,mt:1,fz:0,tr:0},41),
  mk("SIGMA","Sigma","pump","linear-gradient(150deg,#23262e,#0b0c10)",6,0.00004,18000,6000,22000,180,{m5:42,h1:210,h6:210,h24:210},{v:0,s:0,lp:0,mt:0,fz:0,tr:0},12),
  mk("NOOT","Pengu Noot","moon","linear-gradient(150deg,#3b6bff,#1f3fae)",120,0.0006,31000,12000,45000,420,{m5:-3,h1:-8,h6:-13.5,h24:-13.5},{v:0,s:0,lp:0,mt:1,fz:1,tr:0},30),
];

/* ── launch data (new launches feed) ───────────────────── */
function lk(sym,name,grad,age,price,mcap,liq,holders,vol,change,sig,badges){
  return {sym,name,gradient:grad,age,price,mcap,liq,holders,vol,change,sig,badges};
}
const L=[
  lk("SIGMA","Sigma","linear-gradient(150deg,#23262e,#0b0c10)",6,0.00004,18000,6000,180,22000,42,41,[["Just hatched","good"]]),
  lk("DREAMR","Dreamer","linear-gradient(150deg,#4aa3d4,#235a7a)",14,0.0009,92000,38000,810,120000,9,72,[["Strong holders","good"],["Socials live",""]]),
  lk("MOONPIG","Moon Pig","linear-gradient(150deg,#ff8ab0,#b8456e)",18,0.0012,118000,44000,640,156000,17,68,[["LP burned","good"]]),
  lk("ZAPCAT","Zap Cat","linear-gradient(150deg,#9b5cff,#5a2fae)",22,0.0021,210000,64000,1240,340000,14,88,[["Whale in","good"],["Trending",""]]),
  lk("PIXL","Pixel Pup","linear-gradient(150deg,#f5c542,#c8930a)",27,0.0007,64000,22000,390,71000,5,54,[["Low liq","warn"]]),
  lk("FROGE","Froge","linear-gradient(150deg,#6fae5a,#2f5e28)",9,0.00018,27000,9000,210,33000,28,49,[["Just hatched","good"]]),
  lk("WAGMI","We All Gonna Make It","linear-gradient(150deg,#e0606a,#8a2e36)",51,0.0014,140000,31000,560,98000,6,64,[["Socials live",""]]),
  lk("NOOT","Pengu Noot","linear-gradient(150deg,#3b6bff,#1f3fae)",120,0.0006,31000,12000,420,45000,-13.5,38,[["Mint revoked","good"]]),
  lk("TURBO2","Turbo Reborn","linear-gradient(150deg,#ff7a3c,#a23bff)",240,0.0033,420000,88000,2100,510000,22,79,[["Strong holders","good"],["LP burned","good"]]),
  lk("HARAMBE","Harambe SOL","linear-gradient(150deg,#7a6a55,#3a3128)",680,0.0051,610000,120000,3400,720000,8,83,[["Verified","good"]]),
  lk("BLINK","Blink","linear-gradient(150deg,#22d3ee,#0e7490)",900,0.0019,180000,40000,980,160000,-5,57,[]),
];

/* ── state ─────────────────────────────────────────────── */
const S={view:"discover",tab:"trending",tf:"h24",sort:"vol",dir:"desc",q:"",
  chips:new Set(),adv:{mcMin:"",mcMax:"",liqMin:"",volMin:"",holdersMin:"",ageMax:"any"},tg:new Set(),
  lane:"hatched",lf:"all",lsort:"newest"};

/* ── format ────────────────────────────────────────────── */
function fUsd(n){if(n>=1e9)return"$"+(n/1e9).toFixed(2)+"B";if(n>=1e6)return"$"+(n/1e6).toFixed(2)+"M";if(n>=1e3)return"$"+(n/1e3).toFixed(1)+"K";return"$"+n.toFixed(0);}
function fPrice(p){if(p>=1)return"$"+p.toFixed(2);if(p>=0.01)return"$"+p.toFixed(4);if(p>=0.0001)return"$"+p.toFixed(6);return"$"+p.toPrecision(3);}
function fAge(m){if(m<60)return m+"m";if(m<1440)return Math.floor(m/60)+"h";return Math.floor(m/1440)+"d";}
function fHold(n){if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1)+"K";return""+n;}
function fPct(p){return(p>=0?"+":"")+p.toFixed(1)+"%";}
function parseAmt(s){if(!s)return null;s=(""+s).trim().toLowerCase().replace(/[$,\s]/g,"");const m=s.match(/^([\d.]+)([kmb]?)$/);if(!m)return null;let n=parseFloat(m[1]);if(m[2]==="k")n*=1e3;if(m[2]==="m")n*=1e6;if(m[2]==="b")n*=1e9;return isFinite(n)?n:null;}

/* ── discover filtering ────────────────────────────────── */
function activeFilterCount(){let c=0;for(const k of["mcMin","mcMax","liqMin","volMin","holdersMin"])if(S.adv[k].trim())c++;if(S.adv.ageMax!=="any")c++;c+=S.tg.size;return c;}
function passes(t){
  if(S.q){const q=S.q.toLowerCase();if(!t.sym.toLowerCase().includes(q)&&!t.name.toLowerCase().includes(q))return false;}
  const lps=[...S.chips].filter(c=>["pumpfun","raydium","moonshot"].includes(c)),lpMap={pumpfun:"pump",raydium:"ray",moonshot:"moon"};
  if(lps.length&&!lps.map(l=>lpMap[l]).includes(t.lp))return false;
  if(S.chips.has("trending")&&!t.trending)return false;
  if(S.chips.has("verified")&&!t.verified)return false;
  if(S.chips.has("socials")&&!t.socials)return false;
  const mcMin=parseAmt(S.adv.mcMin),mcMax=parseAmt(S.adv.mcMax),liqMin=parseAmt(S.adv.liqMin),volMin=parseAmt(S.adv.volMin),hMin=parseAmt(S.adv.holdersMin);
  if(mcMin!=null&&t.mc<mcMin)return false;
  if(mcMax!=null&&t.mc>mcMax)return false;
  if(liqMin!=null&&t.liq<liqMin)return false;
  if(volMin!=null&&t.vol<volMin)return false;
  if(hMin!=null&&t.holders<hMin)return false;
  if(S.adv.ageMax!=="any"&&t.age>+S.adv.ageMax)return false;
  if(S.tg.has("lpBurned")&&!t.lpBurned)return false;
  if(S.tg.has("mintRevoked")&&!t.mintRevoked)return false;
  if(S.tg.has("freezeRevoked")&&!t.freezeRevoked)return false;
  if(S.tg.has("hideLowLiq")&&t.liq<5000)return false;
  if(S.tab==="graduating"&&(t.gradPct==null||t.gradPct>=100))return false;
  if(S.tab==="new"&&t.age>1440)return false;
  return true;
}
function sortKey(t){if(S.sort==="chg")return t.chg[S.tf];if(S.sort==="age")return -t.age;return t[S.sort];}
const lpClass={pump:"pump",ray:"ray",moon:"moon"},lpName={pump:"PUMP",ray:"RAY",moon:"MOON"};

function renderDiscover(){
  let list=T.filter(passes);const dir=S.dir==="desc"?-1:1;
  list.sort((a,b)=>{const ka=sortKey(a),kb=sortKey(b);return(ka<kb?-1:ka>kb?1:0)*dir;});
  document.getElementById("count").textContent=list.length;
  document.getElementById("countNoun").textContent="tokens";
  const sl={vol:"VOLUME",mc:"MARKET CAP",liq:"LIQUIDITY",holders:"HOLDERS",age:"AGE",chg:"CHANGE"}[S.sort];
  const tl={m5:"5M",h1:"1H",h6:"6H",h24:"24H"}[S.tf];
  document.getElementById("note").textContent="SORTED BY "+sl+" · "+tl;
  document.getElementById("fcount").textContent=activeFilterCount();
  const el=document.getElementById("toklist");
  if(!list.length){el.innerHTML='<div class="empty"><b>No tokens match</b>Loosen a filter or reset to see more.</div>';return;}
  el.innerHTML=list.map(t=>{
    const c=t.chg[S.tf],up=c>=0;
    const grad=t.gradPct!=null?'<div class="gradbar" title="Bonding curve '+t.gradPct+'%"><i style="width:'+t.gradPct+'%"></i></div>':"";
    return '<div class="tok"><div class="logo" style="background:'+t.gradient+'">'+t.sym.slice(0,2)+'</div>'+
      '<div class="mid"><div class="row1"><span class="sym">'+t.sym+'</span><span class="lp '+lpClass[t.lp]+'">'+lpName[t.lp]+'</span>'+
      (t.verified?'<span class="verified" title="Verified">&#10003;</span>':"")+'<span class="name">'+t.name+'</span></div>'+
      '<div class="row2"><span class="k">'+fAge(t.age)+'</span><span class="sep">·</span><span class="k">MC</span> '+fUsd(t.mc)+
      '<span class="sep">·</span><span class="k">Vol</span> '+fUsd(t.vol)+'<span class="sep">·</span><span class="k">Liq</span> '+fUsd(t.liq)+
      '<span class="sep">·</span>'+fHold(t.holders)+' <span class="k">H</span></div>'+grad+'</div>'+
      '<div class="right"><span class="price">'+fPrice(t.price)+'</span><span class="chg '+(up?"up":"down")+'">'+fPct(c)+'</span></div>'+
      '<button class="buy">Buy</button></div>';
  }).join("");
}

/* ── launches filtering ────────────────────────────────── */
function laneOf(t){return t.age<=30?"hatched":"radar";}
function renderLaunches(){
  const hatched=L.filter(t=>laneOf(t)==="hatched").length,radar=L.filter(t=>laneOf(t)==="radar").length;
  document.getElementById("lcHatched").textContent=hatched;
  document.getElementById("lcRadar").textContent=radar;
  let list=L.filter(t=>laneOf(t)===S.lane);
  if(S.q){const q=S.q.toLowerCase();list=list.filter(t=>t.sym.toLowerCase().includes(q)||t.name.toLowerCase().includes(q));}
  if(S.lf!=="all")list=list.filter(t=>t.age<=+S.lf);
  list.sort((a,b)=>S.lsort==="newest"?a.age-b.age:S.lsort==="volume"?b.vol-a.vol:b.sig-a.sig);
  document.getElementById("count").textContent=list.length;
  document.getElementById("countNoun").textContent="launches";
  const sl={newest:"FRESHEST",volume:"LOUDEST",signal:"TOP SIGNAL"}[S.lsort];
  document.getElementById("note").textContent=(S.lane==="hatched"?"JUST HATCHED":"ON RADAR")+" · "+sl;
  const el=document.getElementById("launchfeed");
  if(!list.length){el.innerHTML='<div class="empty"><b>Nothing here yet</b>Switch lanes or loosen the filter — fresh drops land all day.</div>';return;}
  const card=(t,spotlight)=>{
    const up=t.change>=0,fresh=t.age<=5,seed=stkSeed(t.sym);
    const badges=t.badges.map(b=>'<span class="lbadge '+(b[1]||"")+'">'+b[0]+'</span>').join("");
    const inner='<div class="lhead"><div class="lavatar" style="background:'+t.gradient+'">'+t.sym.slice(0,2)+'</div>'+
      '<div class="linfo"><div class="lsym-row"><span class="lsym">$'+t.sym+'</span><span class="agepill'+(fresh?" fresh":"")+'">'+fAge(t.age)+'</span></div>'+
      '<div class="lname">'+t.name+'</div></div>'+
      '<div class="lright"><div class="lprice">'+fPrice(t.price)+'</div><div class="lchg '+(up?"chg up":"chg down")+'" style="display:inline-block">'+fPct(t.change)+'</div></div></div>'+
      '<div class="lspark">'+sparkSvg({seed:seed,up:up,w:320,h:34})+'</div>'+
      '<div class="lmetrics">'+
        '<div class="lmetric"><div class="k">Liq</div><div class="v">'+fUsd(t.liq)+'</div></div>'+
        '<div class="lmetric"><div class="k">MCap</div><div class="v">'+fUsd(t.mcap)+'</div></div>'+
        '<div class="lmetric"><div class="k">Holders</div><div class="v">'+fHold(t.holders)+'</div></div>'+
        '<div class="lmetric"><div class="k">Signal</div><div class="v sig">'+t.sig+'</div></div>'+
      '</div>'+
      (badges?'<div class="lbadges">'+badges+'</div>':"")+
      '<div class="lactions"><button class="lbuy">Buy</button><button class="lsell">Sell</button></div>';
    if(spotlight)return '<div class="spotlight"><div class="spotlight-in"><div class="spot-tag">◆ TOP LAUNCH RIGHT NOW</div>'+inner+'</div></div>';
    return '<div class="lcard">'+inner+'</div>';
  };
  const top=[...list].sort((a,b)=>b.sig-a.sig)[0];
  let html="";
  if(S.lsort!=="signal"){html+=card(top,true);list=list.filter(t=>t!==top);}
  html+=list.map(t=>card(t,false)).join("");
  el.innerHTML=html;
}
function stkSeed(str){let h=0;for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))|0;return(Math.abs(h)||1)>>>0;}

/* ── master render ─────────────────────────────────────── */
function render(){
  const dc=document.getElementById("discoverControls"),lc=document.getElementById("launchControls");
  const tl=document.getElementById("toklist"),lf=document.getElementById("launchfeed");
  if(S.view==="discover"){dc.hidden=false;lc.hidden=true;tl.hidden=false;lf.hidden=true;renderDiscover();}
  else{dc.hidden=true;lc.hidden=false;tl.hidden=true;lf.hidden=false;renderLaunches();}
}

/* ── wiring ────────────────────────────────────────────── */
document.getElementById("viewseg").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  document.querySelectorAll("#viewseg button").forEach(x=>x.classList.remove("on"));b.classList.add("on");S.view=b.dataset.view;render();});

const tabDefaults={new:["age","desc"],trending:["vol","desc"],surging:["chg","desc"],graduating:["chg","desc"],top:["mc","desc"]};
document.getElementById("tabs").addEventListener("click",e=>{const b=e.target.closest(".tab");if(!b)return;
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));b.classList.add("on");
  S.tab=b.dataset.tab;const d=tabDefaults[S.tab];S.sort=d[0];S.dir=d[1];
  document.getElementById("sort").value=S.sort;document.getElementById("dir").textContent=S.dir==="desc"?"↓":"↑";render();});
document.getElementById("tf").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  document.querySelectorAll("#tf button").forEach(x=>x.classList.remove("on"));b.classList.add("on");S.tf=b.dataset.tf;render();});
document.getElementById("chips").addEventListener("click",e=>{const b=e.target.closest(".chip");if(!b)return;
  const c=b.dataset.chip;if(S.chips.has(c)){S.chips.delete(c);b.classList.remove("on");}else{S.chips.add(c);b.classList.add("on");}render();});
document.getElementById("sort").addEventListener("change",e=>{S.sort=e.target.value;render();});
document.getElementById("dir").addEventListener("click",e=>{S.dir=S.dir==="desc"?"asc":"desc";e.target.textContent=S.dir==="desc"?"↓":"↑";render();});
document.getElementById("q").addEventListener("input",e=>{S.q=e.target.value;render();});
const ft=document.getElementById("filtersToggle"),adv=document.getElementById("adv");
ft.addEventListener("click",()=>{ft.classList.toggle("open");adv.classList.toggle("open");});
document.getElementById("toggles").addEventListener("click",e=>{const b=e.target.closest(".toggle");if(!b)return;const k=b.dataset.tg;
  if(S.tg.has(k)){S.tg.delete(k);b.classList.remove("on");}else{S.tg.add(k);b.classList.add("on");}render();});
["mcMin","mcMax","liqMin","volMin","holdersMin"].forEach(id=>document.getElementById(id).addEventListener("input",e=>{S.adv[id]=e.target.value;render();}));
document.getElementById("ageMax").addEventListener("change",e=>{S.adv.ageMax=e.target.value;render();});
document.getElementById("apply").addEventListener("click",()=>{ft.classList.remove("open");adv.classList.remove("open");render();});
document.getElementById("reset").addEventListener("click",()=>{S.chips.clear();S.tg.clear();S.adv={mcMin:"",mcMax:"",liqMin:"",volMin:"",holdersMin:"",ageMax:"any"};S.q="";
  document.querySelectorAll(".chip,.toggle").forEach(x=>x.classList.remove("on"));
  ["mcMin","mcMax","liqMin","volMin","holdersMin"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("ageMax").value="any";document.getElementById("q").value="";render();});

document.getElementById("lanes").addEventListener("click",e=>{const b=e.target.closest(".lane");if(!b)return;
  document.querySelectorAll(".lane").forEach(x=>x.classList.remove("on"));b.classList.add("on");S.lane=b.dataset.lane;render();});
document.getElementById("lf").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  document.querySelectorAll("#lf button").forEach(x=>x.classList.remove("on"));b.classList.add("on");S.lf=b.dataset.lf;render();});
document.getElementById("lsort").addEventListener("change",e=>{S.lsort=e.target.value;render();});

render();
</script>
</body>
</html>
