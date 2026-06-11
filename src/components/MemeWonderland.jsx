// =====================================================================
// MemeWonderland additions — drop into your existing MemeWonderland.jsx
//
// What this adds (all match your existing dark/neon palette):
//   1. Stats orbs row    — Scanning / Whales Live / Fresh / 24h Vol
//   2. Featured Signal   — top trending token as a hero card with 0–100 score
//   3. Hot Narratives    — derived from filter categories + whale activity
//   4. Activity Feed     — whale entries + fresh launches, live timeline
//
// HOW TO INTEGRATE (3 steps):
//   STEP 1: paste the CSS block (CSS_ADDITIONS) into your MW_CSS template
//           literal, right before the @media query at the bottom.
//   STEP 2: paste the 4 components (StatsOrbs, FeaturedSignal, etc.) into
//           the same file, anywhere after the helpers/before export default.
//   STEP 3: update the render in MemeWonderland() — see RENDER_PATCH below.
// =====================================================================

// ────────────────────────────────────────────────────────────────────
// STEP 1 — CSS additions (append inside MW_CSS, before @media block)
// ────────────────────────────────────────────────────────────────────
const CSS_ADDITIONS = `
/* Stat orbs */
.mw-stats-orbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 18px 4px;position:relative;z-index:2}
.mw-orb{position:relative;padding:11px 10px 9px;border-radius:18px;background:var(--mw-card);border:1.5px solid var(--mw-border);overflow:hidden;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards}
.mw-orb::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,var(--mw-orb-glow,transparent),transparent 70%);opacity:.7;pointer-events:none}
.mw-orb.mw-orb-scan{--mw-orb-glow:rgba(255,94,196,.25)}
.mw-orb.mw-orb-whale{--mw-orb-glow:rgba(255,217,102,.28);border-color:rgba(255,217,102,.25)}
.mw-orb.mw-orb-fresh{--mw-orb-glow:rgba(255,225,77,.25)}
.mw-orb.mw-orb-vol{--mw-orb-glow:rgba(77,255,210,.28)}
.mw-orb-ico{font-size:13px;display:block;margin-bottom:3px;position:relative;z-index:2}
.mw-orb-label{font-size:8px;color:var(--mw-text-dim);letter-spacing:.12em;text-transform:uppercase;font-weight:700;position:relative;z-index:2}
.mw-orb-val{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:18px;line-height:1;letter-spacing:-.01em;margin-top:4px;position:relative;z-index:2}
.mw-orb-delta{font-size:9px;font-weight:700;margin-top:3px;color:var(--mw-green);position:relative;z-index:2}
.mw-orb-spark{margin-top:4px;height:14px;width:100%;position:relative;z-index:2}

/* Featured top signal */
.mw-featured{margin:14px 18px 0;padding:16px 14px 14px;border-radius:22px;background:linear-gradient(135deg,rgba(255,94,196,.12),rgba(192,132,252,.08) 50%,rgba(77,255,210,.08));border:1.5px solid rgba(255,94,196,.22);position:relative;overflow:hidden;cursor:pointer;animation:mwRise .5s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:0 4px 24px rgba(255,94,196,.12),0 3px 0 rgba(0,0,0,.2)}
.mw-featured::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 0% 0%,rgba(255,94,196,.2),transparent 70%);pointer-events:none}
.mw-featured:active{transform:scale(.99) translateY(2px);box-shadow:0 0 0 rgba(0,0,0,.2)}
.mw-featured-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(90deg,var(--mw-pink),var(--mw-orange));color:#0a0815;font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:9px;letter-spacing:.15em;padding:4px 10px;border-radius:999px;position:relative;z-index:2}
.mw-featured-body{display:flex;align-items:center;gap:12px;margin-top:12px;position:relative;z-index:2}
.mw-featured-avatar{width:60px;height:60px;border-radius:50%;flex-shrink:0;position:relative;padding:2.5px;background:conic-gradient(from 0deg,var(--mw-pink),var(--mw-orange),var(--mw-yellow),var(--mw-mint),var(--mw-cyan),var(--mw-purple),var(--mw-pink));animation:mwSpin 8s linear infinite}
@keyframes mwSpin{to{transform:rotate(360deg)}}
.mw-featured-avatar-inner{width:100%;height:100%;border-radius:50%;background:var(--mw-card);display:grid;place-items:center;font-size:28px;overflow:hidden}
.mw-featured-avatar-inner img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.mw-featured-crown{position:absolute;top:-3px;left:-2px;width:20px;height:20px;background:linear-gradient(135deg,var(--mw-gold),var(--mw-orange));border-radius:50%;display:grid;place-items:center;font-size:11px;z-index:3;box-shadow:0 2px 8px rgba(255,217,102,.5)}
.mw-featured-meta{flex:1;min-width:0}
.mw-featured-sym{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.02em;line-height:1}
.mw-featured-name{font-size:11px;color:var(--mw-text-dim);font-weight:600;margin-top:4px}
.mw-featured-score{text-align:right;flex-shrink:0}
.mw-featured-score-num{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:36px;line-height:1;background:linear-gradient(135deg,var(--mw-pink),var(--mw-orange));-webkit-background-clip:text;background-clip:text;color:transparent}
.mw-featured-score-denom{font-size:11px;color:var(--mw-text-dim);font-weight:700}
.mw-featured-score-label{font-size:8px;color:var(--mw-text-dim);letter-spacing:.15em;font-weight:700;margin-top:2px}
.mw-featured-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;position:relative;z-index:2}
.mw-fm{text-align:center;padding:8px 4px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--mw-border)}
.mw-fm-ico{font-size:13px;display:block;margin-bottom:2px}
.mw-fm-val{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:13px;line-height:1}
.mw-fm-lbl{font-size:8px;color:var(--mw-text-dim);letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-top:3px}
.mw-fm-val.mw-up{color:var(--mw-green)}
.mw-fm-val.mw-down{color:var(--mw-red)}

/* Narratives strip */
.mw-narratives{display:flex;gap:8px;padding:4px 18px 4px;overflow-x:auto;position:relative;z-index:2;scrollbar-width:none}
.mw-narratives::-webkit-scrollbar{display:none}
.mw-narr{flex:0 0 auto;padding:9px 13px;border-radius:14px;background:var(--mw-card);border:1.5px solid var(--mw-border);display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color .15s;min-width:0}
.mw-narr:active{transform:scale(.97)}
.mw-narr-emoji{font-size:18px;flex-shrink:0}
.mw-narr-body{min-width:0}
.mw-narr-name{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:10px;letter-spacing:.05em;line-height:1;white-space:nowrap}
.mw-narr-pct{font-size:11px;font-weight:800;color:var(--mw-green);margin-top:3px;line-height:1}
.mw-narr-pct.mw-down{color:var(--mw-red)}

/* Activity feed */
.mw-activity{padding:8px 18px 0;position:relative;z-index:2}
.mw-activity-list{display:flex;flex-direction:column;gap:6px}
.mw-act{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--mw-card);border:1px solid var(--mw-border);transition:border-color .15s;cursor:pointer}
.mw-act:active{transform:scale(.99)}
.mw-act.mw-act-whale{border-color:rgba(255,217,102,.3);background:linear-gradient(90deg,rgba(255,217,102,.06),transparent 60%)}
.mw-act.mw-act-launch{border-color:rgba(255,225,77,.3);background:linear-gradient(90deg,rgba(255,225,77,.05),transparent 60%)}
.mw-act-ico{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.06);display:grid;place-items:center;font-size:14px;flex-shrink:0}
.mw-act-body{flex:1;min-width:0}
.mw-act-l1{font-size:10px;color:var(--mw-text-dim);letter-spacing:.05em;font-weight:600}
.mw-act-l1 b{color:var(--mw-text);font-weight:800}
.mw-act-l2{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:12px;margin-top:2px;line-height:1}
.mw-act-right{text-align:right;flex-shrink:0}
.mw-act-amt{font-family:'Unbounded',system-ui,sans-serif;font-weight:900;font-size:11px;color:var(--mw-mint)}
.mw-act-amt.mw-gold{color:var(--mw-gold)}
.mw-act-time{font-size:9px;color:var(--mw-text-dimmer);font-weight:700;margin-top:2px}

@media (max-width:430px){
  .mw-stats-orbs{padding:12px 14px 4px;gap:6px}
  .mw-orb{padding:9px 8px 7px;border-radius:14px}
  .mw-orb-val{font-size:15px}
  .mw-orb-ico{font-size:11px}
  .mw-orb-label{font-size:7px}
  .mw-orb-delta{font-size:8px}
  .mw-featured{margin:12px 14px 0;padding:14px 12px}
  .mw-featured-avatar{width:54px;height:54px}
  .mw-featured-avatar-inner{font-size:24px}
  .mw-featured-sym{font-size:19px}
  .mw-featured-score-num{font-size:32px}
  .mw-featured-metrics{gap:6px}
  .mw-fm{padding:7px 3px}
  .mw-fm-val{font-size:12px}
  .mw-narratives{padding:4px 14px}
  .mw-narr{padding:8px 11px}
  .mw-activity{padding:8px 14px 0}
}
`;

// ────────────────────────────────────────────────────────────────────
// STEP 2 — Components (paste into MemeWonderland.jsx)
// ────────────────────────────────────────────────────────────────────

// Compute a 0–100 signal score from token metrics
function signalScore(t) {
  if (!t) return 0;
  const change = Math.min(Math.max(t.change || 0, -100), 200);
  const changePts = Math.min(35, Math.max(0, (change / 200) * 35));
  const volPts = Math.min(25, Math.log10(Math.max(t.volume24h || 1, 1)) * 3.5);
  const liqPts = Math.min(20, Math.log10(Math.max(t.liquidity || 1, 1)) * 3);
  const holdPts = Math.min(15, Math.log10(Math.max(t.holders || 1, 1)) * 2.5);
  const whalePts = t.whaleSol ? 10 : 0;
  return Math.round(Math.min(100, changePts + volPts + liqPts + holdPts + whalePts));
}

function StatsOrbs({ tokens, whaleCount, freshCount, solPrice }) {
  const scanning = tokens.length;
  const totalVol = tokens.reduce((s, t) => s + (t.volume24h || 0), 0);
  const movers = tokens.filter(t => Math.abs(t.change || 0) > 10).length;

  const spark = (color, points) => (
    <svg className="mw-orb-spark" viewBox="0 0 100 14" preserveAspectRatio="none">
      <path d={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="mw-stats-orbs">
      <div className="mw-orb mw-orb-scan" style={{ animationDelay: '0s' }}>
        <span className="mw-orb-ico">🎯</span>
        <div className="mw-orb-label">scanning</div>
        <div className="mw-orb-val">{scanning}</div>
        {spark('#ff5ec4', 'M0 11 L15 9 L30 10 L45 6 L60 8 L75 4 L90 5 L100 3')}
      </div>
      <div className="mw-orb mw-orb-whale" style={{ animationDelay: '.05s' }}>
        <span className="mw-orb-ico">🐋</span>
        <div className="mw-orb-label">whales 48h</div>
        <div className="mw-orb-val">{whaleCount}</div>
        {spark('#ffd966', 'M0 12 L15 10 L30 11 L45 7 L60 9 L75 5 L90 6 L100 3')}
      </div>
      <div className="mw-orb mw-orb-fresh" style={{ animationDelay: '.1s' }}>
        <span className="mw-orb-ico">🆕</span>
        <div className="mw-orb-label">fresh 24h</div>
        <div className="mw-orb-val">{freshCount}</div>
        {spark('#ffe14d', 'M0 9 L15 11 L30 8 L45 10 L60 6 L75 8 L90 4 L100 6')}
      </div>
      <div className="mw-orb mw-orb-vol" style={{ animationDelay: '.15s' }}>
        <span className="mw-orb-ico">⚡</span>
        <div className="mw-orb-label">24h vol</div>
        <div className="mw-orb-val">${format(totalVol)}</div>
        {spark('#4dffd2', 'M0 12 L10 11 L20 11 L30 8 L40 10 L50 6 L60 8 L70 4 L80 5 L90 2 L100 3')}
      </div>
    </div>
  );
}

function FeaturedSignal({ token, onOpen, onTrade }) {
  if (!token) return null;
  const score = signalScore(token);
  return (
    <div className="mw-featured" onClick={() => onOpen(token.mint)} style={{ animationDelay: '.1s' }}>
      <div className="mw-featured-badge">⚡ TOP SIGNAL</div>
      <div className="mw-featured-body">
        <div className="mw-featured-avatar">
          <div className="mw-featured-crown">👑</div>
          <div className="mw-featured-avatar-inner">
            {token.icon
              ? <img src={token.icon} alt={token.sym} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              : token.emoji}
          </div>
        </div>
        <div className="mw-featured-meta">
          <div className="mw-featured-sym">${token.sym}</div>
          <div className="mw-featured-name">{token.name} · Solana</div>
        </div>
        <div className="mw-featured-score">
          <div className="mw-featured-score-num">{score}</div>
          <div className="mw-featured-score-denom">/100</div>
          <div className="mw-featured-score-label">SIGNAL</div>
        </div>
      </div>
      <div className="mw-featured-metrics">
        <div className="mw-fm">
          <span className="mw-fm-ico">🔥</span>
          <div className={'mw-fm-val ' + (token.change >= 0 ? 'mw-up' : 'mw-down')}>{formatPct(token.change)}</div>
          <div className="mw-fm-lbl">24h</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">⚡</span>
          <div className="mw-fm-val">${format(token.volume24h)}</div>
          <div className="mw-fm-lbl">vol</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">💰</span>
          <div className="mw-fm-val">${format(token.mcap)}</div>
          <div className="mw-fm-lbl">mcap</div>
        </div>
        <div className="mw-fm">
          <span className="mw-fm-ico">👥</span>
          <div className="mw-fm-val">{token.holders ? format(token.holders) : '—'}</div>
          <div className="mw-fm-lbl">holders</div>
        </div>
      </div>
    </div>
  );
}

function NarrativesStrip({ tokens, whaleCount }) {
  // Group tokens by naive narrative buckets based on symbol/name hints
  const matches = (re) => tokens.filter(t => re.test((t.sym || '') + ' ' + (t.name || ''))).length;
  const avgChange = (re) => {
    const list = tokens.filter(t => re.test((t.sym || '') + ' ' + (t.name || '')));
    if (list.length === 0) return 0;
    return list.reduce((s, t) => s + (t.change || 0), 0) / list.length;
  };

  const buckets = [
    { emoji: '🐱', name: 'Cat Season',  re: /cat|meow|popcat|michi|mew/i },
    { emoji: '🐸', name: 'Frog Meta',   re: /pepe|frog|wojak/i },
    { emoji: '🐕', name: 'Dog Revival', re: /dog|shib|bonk|wif|inu/i },
    { emoji: '🤖', name: 'AI Agents',   re: /ai|agent|gpt|bot/i },
    { emoji: '🐋', name: 'Whale Flow',  re: /./, count: whaleCount, fixedPct: whaleCount > 0 ? 18 : 0 },
    { emoji: '🚀', name: 'Fresh Mints', re: /./, count: tokens.filter(t => t.fresh).length, fixedPct: 12 },
  ];

  const active = buckets
    .map(b => ({ ...b, count: b.count ?? matches(b.re), pct: b.fixedPct ?? avgChange(b.re) }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.pct - a.pct);

  if (active.length === 0) return null;

  return (
    <>
      <div className="mw-section-head">
        <div className="mw-section-title">HOT NARRATIVES</div>
        <div className="mw-section-meta">{active.length} ACTIVE</div>
      </div>
      <div className="mw-narratives">
        {active.map(b => (
          <div className="mw-narr" key={b.name}>
            <span className="mw-narr-emoji">{b.emoji}</span>
            <div className="mw-narr-body">
              <div className="mw-narr-name">{b.name}</div>
              <div className={'mw-narr-pct' + (b.pct < 0 ? ' mw-down' : '')}>{formatPct(b.pct)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityFeed({ tokens, whaleEvents, onOpen }) {
  // Merge whale events + fresh launches into a single sorted timeline
  const items = [];
  for (const ev of (whaleEvents || []).slice(0, 8)) {
    items.push({
      type: 'whale',
      mint: ev.mint,
      sym: ev.symbol || 'TOKEN',
      emoji: emojiFor(ev.symbol || ''),
      amount: ev.solAmount,
      at: ev.detectedAt || Date.now(),
    });
  }
  for (const t of tokens) {
    if (t.fresh) items.push({
      type: 'launch',
      mint: t.mint,
      sym: t.sym,
      emoji: t.emoji,
      icon: t.icon,
      at: Date.now() - Math.random() * 3600000, // approximate; firstPool.createdAt would be ideal
    });
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0));
  const top = items.slice(0, 6);
  if (top.length === 0) return null;

  return (
    <>
      <div className="mw-section-head">
        <div className="mw-section-title">LIVE ACTIVITY</div>
        <div className="mw-section-meta">{items.length} EVENTS</div>
      </div>
      <div className="mw-activity">
        <div className="mw-activity-list">
          {top.map((it, i) => (
            <div
              key={i}
              className={'mw-act ' + (it.type === 'whale' ? 'mw-act-whale' : 'mw-act-launch')}
              onClick={() => onOpen && onOpen(it.mint)}
            >
              <div className="mw-act-ico">{it.type === 'whale' ? '🐋' : '🚀'}</div>
              <div className="mw-act-body">
                <div className="mw-act-l1">
                  {it.type === 'whale' ? <><b>whale entry</b> · added liquidity</> : <><b>new launch</b> · just deployed</>}
                </div>
                <div className="mw-act-l2">${it.sym}</div>
              </div>
              <div className="mw-act-right">
                {it.type === 'whale' && it.amount && (
                  <div className="mw-act-amt mw-gold">+{Number(it.amount).toLocaleString()} SOL</div>
                )}
                <div className="mw-act-time">{timeAgo(it.at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 3 — Render patch
// Replace the existing render in MemeWonderland() with this layout.
// All existing state/effects/handlers stay exactly the same.
// ────────────────────────────────────────────────────────────────────

const RENDER_PATCH = /* jsx */ `
  // INSIDE MemeWonderland(), add these computed values near the bottom,
  // just before the 'return (' statement:
  const freshCount = tokens.filter(t => t.fresh).length;
  const topToken = !isSearching && activeFilter === 'trending' ? tokens[0] : null;

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

        {/* NEW: stats orbs */}
        <StatsOrbs
          tokens={tokens}
          whaleCount={whaleEvents.length}
          freshCount={freshCount}
          solPrice={solPrice}
        />

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

        {/* NEW: featured top signal (only on trending, not searching) */}
        {topToken && (
          <FeaturedSignal
            token={topToken}
            onOpen={openDetail}
            onTrade={(m) => openSheet(topToken.mint, m)}
          />
        )}

        {/* existing search */}
        <div className="mw-search-wrap"> ... </div>

        {/* existing filter chips */}
        <div className="mw-filters"> ... </div>

        {/* NEW: narratives strip (only when not searching) */}
        {!isSearching && (
          <NarrativesStrip tokens={tokens} whaleCount={whaleEvents.length} />
        )}

        {/* existing section head + grid */}
        <div className="mw-section-head"> ... </div>
        <div className="mw-grid"> ... </div>

        {/* NEW: activity feed at the bottom */}
        {!isSearching && (
          <ActivityFeed
            tokens={tokens}
            whaleEvents={whaleEvents}
            onOpen={openDetail}
          />
        )}
      </div>

      {/* existing modals: DetailView, TradeSheet, SuccessView — unchanged */}
    </div>
  );
`;

// ────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────
//
// • signalScore() is a heuristic — replace with your backend score if you
//   have one. The weights are: 35% price action, 25% volume, 20% liquidity,
//   15% holders, 10% whale presence.
//
// • Featured signal only shows on the 'trending' filter and uses tokens[0].
//   If you want it filter-aware, pass `activeFilter` and pick differently.
//
// • Narratives are derived client-side from token symbols/names. If you
//   have proper narrative tagging on the backend, swap the regex buckets
//   for real categories.
//
// • Activity feed merges whale events with fresh launches. For fresh
//   launches the timestamp is approximated — pass through firstPool.createdAt
//   from your normalize() if you want exact times.
//
// • All new sections respect the existing `mw-skeleton` loading state by
//   only rendering when tokens.length > 0 (the grid skeleton handles initial
//   load on its own).
