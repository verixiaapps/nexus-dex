/* ============================================================================
 * Flipsy.jsx — BRACKETS UI
 * ----------------------------------------------------------------------------
 * Consumes the bracket version of useFlipsy:
 *  - Live round is WATCH-ONLY (betting locks 60s before close). Shows your locked
 *    pick, the live move, and each bracket's live payout.
 *  - Upcoming rounds are bettable: four bracket buttons, each showing its LIVE
 *    payout multiplier computed from that round's pools (updates every poll).
 *  - Per-bracket payout = totalPot / bracketPool, minus 5% on profit. Shown as an
 *    estimate ("~X×") because it moves as people bet, and "—" when a bracket is empty.
 *  - Old binary (heads/tails) layout + dead fp-* CSS removed.
 * ==========================================================================*/
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';

// ============================================================
// INLINE CSS
// ============================================================
const FLIPSY_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.fl-page{
  --ink:#2a2342;--ink-2:#6b6588;--ink-3:#a9a4c0;
  --vio:#6d4aff;--viod:#5a37e6;--up:#13c98c;--upd:#0fae78;--down:#ff5d7e;--downd:#f23d63;--gold:#ffb13d;
  min-height:100dvh;color:var(--ink);
  font-family:'Space Grotesk',-apple-system,system-ui,sans-serif;
  background:linear-gradient(170deg,#f1edfc 0%,#eaf4f1 52%,#f3eefb 100%);
  padding-bottom:calc(env(safe-area-inset-bottom) + 40px);overflow-x:hidden;
}
.fl-page *{box-sizing:border-box}
.fl-inner{max-width:480px;margin:0 auto}
.fl-mono{font-family:'JetBrains Mono',monospace}
@keyframes fl-pl{50%{opacity:.4}}

/* header */
.fl-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
.fl-br{display:flex;align-items:center;gap:10px}
.fl-mascot{width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#8b6bff,#6d4aff 60%,#5a37e6);display:grid;place-items:center;font-weight:800;font-size:19px;color:#fff;box-shadow:0 5px 16px rgba(109,74,255,.42),inset 0 0 0 2px rgba(255,255,255,.25)}
.fl-bt{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1;color:#36284f}
.fl-bs{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:#8a85a6;margin-top:3px}
.fl-hr{display:flex;align-items:center;gap:8px}
.fl-streak{display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#ffc861,#ff9d3c);border-radius:999px;padding:7px 11px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:#5a3500}
.fl-bal{display:flex;flex-direction:column;align-items:flex-end;background:#fff;border-radius:14px;padding:6px 12px;box-shadow:0 4px 12px rgba(80,60,160,.1)}
.fl-bal.connect{cursor:pointer;background:linear-gradient(135deg,#6d4aff,#8b6bff)}
.fl-bal.connect .fl-bal-v{color:#fff}
.fl-bal.warn{box-shadow:0 0 0 1.5px var(--down) inset,0 4px 12px rgba(80,60,160,.1)}
.fl-bal-l{font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:.12em;color:var(--ink-3)}
.fl-bal-v{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--vio)}
.fl-bal-v.fail{color:var(--down)}

.fl-tag{margin:4px 16px 2px;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.05em;color:#8a85a6;display:flex;align-items:center;gap:7px}
.fl-tag .d{width:5px;height:5px;border-radius:50%;background:var(--up);box-shadow:0 0 7px var(--up)}

.fl-prow{display:flex;align-items:center;gap:9px;padding:8px 16px 4px}
.fl-ppill{display:flex;align-items:center;gap:10px;background:#fff;border-radius:999px;padding:6px 16px 6px 6px;box-shadow:0 5px 16px rgba(80,60,160,.12)}
.fl-ptok{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#6d4aff,#13c98c);display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px}
.fl-pv{font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:700;line-height:1}
.fl-pl{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.1em;color:var(--ink-3);margin-top:2px}
.fl-pips{display:flex;gap:3px;margin-left:auto;align-items:center}
.fl-pip{width:9px;height:9px;border-radius:50%}
.fl-pip.u{background:var(--up);box-shadow:0 2px 5px rgba(19,201,140,.5)}
.fl-pip.d{background:var(--down);opacity:.55}
.fl-pip.t{background:var(--ink-3);opacity:.5}

.fl-sec{display:flex;align-items:baseline;justify-content:space-between;padding:14px 18px 8px}
.fl-sec h3{font-size:16px;font-weight:800;color:#36284f}
.fl-sec em{font-style:normal;font-family:'JetBrains Mono',monospace;color:var(--vio)}
.fl-sec .r{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8a85a6}

/* LIVE round — watch only (dark) */
.fl-hero{margin:0 15px;border-radius:26px;padding:14px;position:relative;overflow:hidden;background:radial-gradient(120% 90% at 50% -10%,#2c2150,#1a1330 70%);box-shadow:0 22px 50px rgba(40,25,90,.4),inset 0 0 0 1px rgba(255,255,255,.06);color:#e9e4ff}
.fl-htop{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.fl-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:#c9bcff;letter-spacing:.04em}
.fl-live .d{width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 9px var(--up);animation:fl-pl 1.3s infinite}
.fl-live .ep{font-family:'JetBrains Mono',monospace;font-size:11px;color:#8579b8;margin-left:2px}
.fl-ring{position:relative;width:54px;height:54px}
.fl-ring svg{transform:rotate(-90deg)}
.fl-ring .tt{position:absolute;inset:0;display:grid;place-items:center;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:#fff}
.fl-ring .tl{font-size:6.5px;letter-spacing:.1em;color:#8579b8;margin-top:14px}
.fl-locked{display:inline-flex;align-items:center;gap:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:#b7a9ee;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 9px;margin-bottom:10px}
.fl-prow2{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px}
.fl-price{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;line-height:1}
.fl-lockpx{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8579b8;margin-top:4px}
.fl-move{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;border-radius:999px;padding:6px 11px}
/* bracket scale (used on live round) */
.fl-scale{display:flex;gap:4px}
.fl-seg{flex:1;text-align:center;padding:8px 4px;border-radius:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07)}
.fl-seg .sr{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:#a99ee0;font-weight:700}
.fl-seg .sx{font-family:'JetBrains Mono',monospace;font-size:11px;color:#fff;font-weight:700;margin-top:3px}
.fl-seg .sp{font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#7a6fae;margin-top:2px}
.fl-seg.here{background:linear-gradient(135deg,rgba(19,201,140,.3),rgba(19,201,140,.12));border-color:rgba(95,240,184,.5)}
.fl-seg.here .sr{color:#5ff0b8}
.fl-seg.mine{outline:2px solid #8b6bff;outline-offset:1px}
.fl-yours{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#c9bcff;text-align:center;margin-top:10px}
.fl-yours b{color:#fff}

/* upcoming feed */
.fl-feed{padding:0 15px;display:flex;flex-direction:column;gap:11px}
.fl-hint{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8a85a6;text-align:center;padding:0 24px 4px;line-height:1.5}
.fl-fc{background:#fff;border-radius:20px;padding:12px 13px;box-shadow:0 6px 16px rgba(80,55,160,.1);border-left:3px solid transparent}
.fl-fc.next{border-left-color:var(--vio);box-shadow:0 8px 20px rgba(109,74,255,.16)}
.fl-fctop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.fl-fcl{display:flex;align-items:center;gap:8px}
.fl-fcep{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--vio)}
.fl-badge{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.08em;color:#fff;background:linear-gradient(135deg,#6d4aff,#8b6bff);border-radius:999px;padding:3px 8px}
.fl-badge.soon{background:#efe9fb;color:#8579b8}
.fl-when{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--ink-2)}
.fl-when .k{font-size:8px;color:var(--ink-3);letter-spacing:.08em;margin-right:4px}
.fl-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.fl-bk{border:none;border-radius:13px;padding:9px 10px;cursor:pointer;color:#fff;font-family:'Space Grotesk',sans-serif;display:flex;align-items:center;justify-content:space-between;gap:6px;text-align:left}
.fl-bk:active{transform:translateY(1px)}
.fl-bk .bl{display:flex;flex-direction:column;line-height:1.1}
.fl-bk .ba{font-size:12px;font-weight:800}
.fl-bk .bp{font-family:'JetBrains Mono',monospace;font-size:8px;opacity:.9;margin-top:2px}
.fl-bk .bm{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700}
.fl-bk.u{background:linear-gradient(135deg,#3fdda6,#17bd86)}
.fl-bk.uu{background:linear-gradient(135deg,#12b884,#0a8f66);box-shadow:0 0 0 1px rgba(19,201,140,.4),0 6px 16px rgba(19,201,140,.35)}
.fl-bk.d{background:linear-gradient(135deg,#ff8aa2,#f2566f)}
.fl-bk.dd{background:linear-gradient(135deg,#f2456a,#cf2c50);box-shadow:0 0 0 1px rgba(242,69,106,.4),0 6px 16px rgba(242,69,106,.35)}
.fl-fcfoot{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--ink-3);text-align:center;margin-top:8px}
.fl-fcfoot b{color:var(--ink-2)}

/* empty / loading */
.fl-empty{background:#fff;border-radius:24px;margin:0 15px;padding:28px 18px;text-align:center;box-shadow:0 10px 26px rgba(80,55,160,.12);font-family:'JetBrains Mono',monospace;color:var(--ink-2);font-size:12px}
.fl-empty .i{font-size:28px;margin-bottom:8px}
.fl-empty .t{font-weight:700;color:var(--ink);font-size:14px;margin-bottom:4px;font-family:'Space Grotesk',sans-serif}
.fl-empty.err .t{color:var(--down)}

/* flash */
.fl-flashwrap{position:sticky;top:8px;z-index:60;display:flex;justify-content:center;pointer-events:none;padding:6px 14px 0}
.fl-flash{pointer-events:auto;padding:10px 16px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#fff;box-shadow:0 10px 26px rgba(0,0,0,.16)}
.fl-flash.success{background:linear-gradient(135deg,#1ad99a,#12b884)}
.fl-flash.error{background:linear-gradient(135deg,#ff6f8d,#f2456a)}

/* tabs / footer */
.fl-tabs{display:flex;gap:8px;padding:20px 15px 4px}
.fl-tab{flex:1;text-align:center;padding:12px;border-radius:16px;font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace;background:rgba(255,255,255,.7);color:#8a85a6;box-shadow:0 5px 14px rgba(80,55,160,.08);cursor:pointer}
.fl-tab.on{background:linear-gradient(135deg,#6d4aff,#8b6bff);color:#fff}
.fl-tab.disabled{opacity:.55;cursor:default}
.fl-soon{font-size:7px;letter-spacing:.06em;background:var(--ink-3);color:#fff;border-radius:999px;padding:1px 5px;margin-left:5px}
.fl-foot{text-align:center;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink-3);padding:16px 24px 8px;line-height:1.5}

/* bet sheet + rounds sheet */
.fl-backdrop{position:fixed;inset:0;background:rgba(20,12,45,.5);z-index:200}
.fl-sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:480px;z-index:210;background:#fff;border-radius:24px 24px 0 0;padding:16px 16px calc(env(safe-area-inset-bottom) + 18px);box-shadow:0 -12px 40px rgba(40,25,90,.3)}
.fl-grab{width:40px;height:4px;border-radius:999px;background:#e3ddf2;margin:0 auto 14px}
.fl-shhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.fl-shtitle{font-size:16px;font-weight:800;color:#36284f}
.fl-close{border:none;background:#f2eefb;color:#6b6588;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer}
.fl-pickpill{display:inline-flex;align-items:center;gap:7px;border-radius:14px;padding:9px 13px;color:#fff;font-weight:800;font-size:14px;margin-bottom:12px}
.fl-pickpill .rng{font-family:'JetBrains Mono',monospace;font-size:10px;opacity:.9;font-weight:700}
.fl-pickpill.u{background:linear-gradient(135deg,#3fdda6,#17bd86)}
.fl-pickpill.uu{background:linear-gradient(135deg,#12b884,#0a8f66)}
.fl-pickpill.d{background:linear-gradient(135deg,#ff8aa2,#f2566f)}
.fl-pickpill.dd{background:linear-gradient(135deg,#f2456a,#cf2c50)}
.fl-amt{display:flex;align-items:center;gap:8px;background:#f7f5fd;border-radius:16px;padding:14px 16px;margin-bottom:10px}
.fl-amt .dollar{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;color:var(--ink-3)}
.fl-amt input{border:none;background:none;outline:none;font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;color:var(--ink);width:100%}
.fl-chips{display:flex;gap:7px;margin-bottom:12px}
.fl-chip{flex:1;border:1px solid #e7e3f5;background:#fff;border-radius:12px;padding:9px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;color:var(--ink-2);cursor:pointer}
.fl-chip.on{background:#efe9fb;border-color:#c9bcff;color:var(--vio)}
.fl-est{display:flex;justify-content:space-between;align-items:center;background:#f2eefb;border-radius:14px;padding:11px 14px;margin-bottom:12px;font-family:'JetBrains Mono',monospace}
.fl-est .l{font-size:9px;letter-spacing:.1em;color:var(--ink-3)}
.fl-est .v{font-size:16px;font-weight:700;color:var(--vio)}
.fl-cta{width:100%;border:none;border-radius:16px;padding:15px;font-size:15px;font-weight:800;color:#fff;font-family:'Space Grotesk',sans-serif;background:linear-gradient(135deg,#6d4aff,#8b6bff);cursor:pointer}
.fl-cta:disabled{opacity:.5;cursor:default}
.fl-sherr{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--down);text-align:center;margin-top:9px}
.fl-shnote{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--ink-3);text-align:center;margin-top:9px;line-height:1.5}

/* rounds list rows */
.fl-rrow{display:flex;align-items:center;justify-content:space-between;padding:12px 4px;border-bottom:1px solid #f0ecf9}
.fl-rrow .ep{font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--vio);font-size:13px}
.fl-rrow .st{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-3);margin-top:2px}
.fl-rrow .claim{border:none;border-radius:12px;padding:8px 13px;font-weight:800;font-size:12px;color:#03281a;background:linear-gradient(135deg,#6df2a8,#19d27a);cursor:pointer}
.fl-rempty{text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink-3);padding:24px}

/* block screen */
.fl-block{min-height:100dvh;display:grid;place-items:center;padding:24px;background:linear-gradient(170deg,#f1edfc,#eaf4f1);text-align:center}
.fl-block-card{background:#fff;border-radius:24px;padding:34px 26px;max-width:340px;box-shadow:0 16px 40px rgba(80,55,160,.16)}
.fl-block-i{font-size:34px;margin-bottom:12px}
.fl-block-t{font-size:20px;font-weight:800;color:#36284f;margin-bottom:8px}
.fl-block-t em{font-style:normal;color:var(--vio)}
.fl-block-m{font-size:13px;color:var(--ink-2);line-height:1.5}
.fl-block-s{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-3);margin-top:12px}

@media (prefers-reduced-motion:reduce){ .fl-page *{animation:none !important} }
`;

function injectFlipsyStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('flipsy-inline-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'flipsy-inline-styles';
  tag.textContent = FLIPSY_CSS;
  document.head.appendChild(tag);
}

// ============================================================
// BRACKET METADATA + PAYOUT MATH (mirrors the contract)
// ============================================================
const THRESHOLD_BPS = 50; // 0.5% — must match BRACKET_THRESHOLD_BPS in lib.rs

// Grid order: up row, then down row.
const BRACKET_META = [
  { key: 'upSmall',   label: '▲ Up',    range: '0–0.5%', cls: 'u'  },
  { key: 'upBig',     label: '▲▲ Up',   range: '>0.5%',  cls: 'uu' },
  { key: 'downSmall', label: '▼ Down',  range: '0–0.5%', cls: 'd'  },
  { key: 'downBig',   label: '▼▼ Down', range: '>0.5%',  cls: 'dd' },
];
// Left-to-right order for the live "scale" (most-down .. most-up).
const SCALE_ORDER = ['downBig', 'downSmall', 'upSmall', 'upBig'];
const META = Object.fromEntries(BRACKET_META.map(b => [b.key, b]));

// Live payout multiplier for one bracket, from the current pools.
// = totalPot / bracketPool, with the fee taken off the profit. null if empty.
function bracketMult(poolUsd, totalUsd, feeBps) {
  if (!(poolUsd > 0)) return null;
  const gross = totalUsd / poolUsd;
  const fee = (gross - 1) * ((feeBps || 0) / 10000);
  return Math.max(0, gross - fee);
}
const fmtMult = (m) => (m == null ? '—' : '~' + m.toFixed(2) + '×');
const fmtUsd = (n) => '$' + (Number(n) || 0).toFixed(2);

// Which bracket does a live price sit in, vs the lock price?
function moveBracket(lockPrice, price) {
  if (!lockPrice || !price) return null;
  if (price === lockPrice) return 'tie';
  const mag = (Math.abs(price - lockPrice) / lockPrice) * 10000;
  const big = mag >= THRESHOLD_BPS;
  if (price > lockPrice) return big ? 'upBig' : 'upSmall';
  return big ? 'downBig' : 'downSmall';
}

const OUTCOME_LABEL = {
  upSmall: 'Up 0–0.5%', upBig: 'Up >0.5%',
  downSmall: 'Down 0–0.5%', downBig: 'Down >0.5%',
  tie: 'Flat (refund)', allLost: 'No winners', unresolved: 'Pending',
};

// ============================================================
// SUBCOMPONENTS
// ============================================================
function BlockScreen({ title, message, sub }) {
  return (
    <div className="fl-block">
      <div className="fl-block-card">
        <div className="fl-block-i">🌍</div>
        <div className="fl-block-t">{title}</div>
        <div className="fl-block-m">{message}</div>
        {sub && <div className="fl-block-s">{sub}</div>}
      </div>
    </div>
  );
}

// Live (locked) round — watch only, shows each bracket's live payout.
function LiveHero({ round, livePrice, myBets, feeBps }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  const total = round.totalPool || 0;
  const timeLeft = Math.max(0, (round.closeTime || 0) - now);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const dur = Math.max(1, (round.closeTime || 0) - (round.startTime || 0));
  const frac = Math.min(1, Math.max(0, timeLeft / dur));
  const C = 2 * Math.PI * 24; // r=24
  const urgent = timeLeft <= 30;

  const lockPx = round.lockPrice || 0;
  const here = moveBracket(lockPx, livePrice);
  const diff = lockPx > 0 ? livePrice - lockPx : 0;
  const up = diff >= 0;
  const mineKeys = new Set((myBets || []).map(b => b.bracket));

  return (
    <div className="fl-hero">
      <div className="fl-htop">
        <span className="fl-live"><span className="d" />LIVE<span className="ep">#{round.epoch}</span></span>
        <div className="fl-ring">
          <svg width="54" height="54" viewBox="0 0 54 54">
            <circle cx="27" cy="27" r="24" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
            <circle cx="27" cy="27" r="24" fill="none" stroke={urgent ? '#ff6f8d' : '#8b6bff'} strokeWidth="4"
              strokeLinecap="round" strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - frac)).toFixed(1)} />
          </svg>
          <div className="tt">{fmt(timeLeft)}<span className="tl">LEFT</span></div>
        </div>
      </div>

      <div className="fl-locked">🔒 Betting closed — locked at go-live</div>

      <div className="fl-prow2">
        <div>
          <div className="fl-price" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
            {livePrice > 0 ? '$' + livePrice.toFixed(4) : '—'}
          </div>
          <div className="fl-lockpx">locked {lockPx > 0 ? '$' + lockPx.toFixed(4) : '—'}</div>
        </div>
        {lockPx > 0 && (
          <div className="fl-move" style={{ background: up ? 'var(--up)' : 'var(--down)', color: up ? '#03281a' : '#fff' }}>
            {up ? '↑' : '↓'} {((Math.abs(diff) / lockPx) * 100).toFixed(2)}%
          </div>
        )}
      </div>

      <div className="fl-scale">
        {SCALE_ORDER.map((k) => {
          const m = META[k];
          const mult = bracketMult(round.pools?.[k] || 0, total, feeBps);
          const cls = ['fl-seg', here === k ? 'here' : '', mineKeys.has(k) ? 'mine' : ''].join(' ').trim();
          return (
            <div className={cls} key={k}>
              <div className="sr">{m.label.replace(' ', '')}<br />{m.range}</div>
              <div className="sx">{fmtMult(mult)}</div>
              <div className="sp">{fmtUsd(round.pools?.[k] || 0)}</div>
            </div>
          );
        })}
      </div>

      {mineKeys.size > 0 ? (
        <div className="fl-yours">Your pick: <b>{[...mineKeys].map(k => OUTCOME_LABEL[k]).join(', ')}</b> · pot {fmtUsd(total)}</div>
      ) : (
        <div className="fl-yours">You didn’t enter this round · pot {fmtUsd(total)}</div>
      )}
    </div>
  );
}

// One upcoming (bettable) round — 4 bracket buttons with live payouts.
function UpcomingCard({ round, isNext, onPick, feeBps }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  const total = round.totalPool || 0;
  const startsIn = Math.max(0, (round.startTime || 0) - now);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const anyBets = total > 0;

  return (
    <div className={'fl-fc' + (isNext ? ' next' : '')}>
      <div className="fl-fctop">
        <div className="fl-fcl">
          <span className="fl-fcep">#{round.epoch}</span>
          <span className={'fl-badge' + (isNext ? '' : ' soon')}>{isNext ? 'NEXT' : 'SOON'}</span>
        </div>
        <span className="fl-when"><span className="k">STARTS</span>{fmt(startsIn)}</span>
      </div>
      <div className="fl-grid">
        {BRACKET_META.map((b) => {
          const mult = bracketMult(round.pools?.[b.key] || 0, total, feeBps);
          return (
            <button className={'fl-bk ' + b.cls} key={b.key} onClick={() => onPick(round.epoch, b.key)}>
              <span className="bl"><span className="ba">{b.label}</span><span className="bp">{b.range}</span></span>
              <span className="bm">{fmtMult(mult)}</span>
            </button>
          );
        })}
      </div>
      <div className="fl-fcfoot">
        {anyBets ? <>pool <b>{fmtUsd(total)}</b> · {round.betCount} bets · payouts are live estimates</>
                 : <>empty — bet first and set the odds</>}
      </div>
    </div>
  );
}

function BetModal({ open, epoch, bracket, round, feeBps, balance, minUsd, maxUsd, onClose, onConfirm }) {
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setAmt(''); setErr(null); setBusy(false); } }, [open, epoch, bracket]);
  if (!open) return null;

  const meta = META[bracket];
  const total = round?.totalPool || 0;
  const pool = round?.pools?.[bracket] || 0;
  const usd = parseFloat(amt) || 0;
  // Payout estimate: recompute with this bet added to the bracket pool.
  const mult = bracketMult(pool + usd, total + usd, feeBps);
  const est = mult != null ? usd * mult : 0;
  const chips = [minUsd, 10, 25, maxUsd].filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  const submit = async () => {
    setErr(null);
    if (usd < minUsd) { setErr(`Minimum bet is ${fmtUsd(minUsd)}`); return; }
    if (usd > maxUsd) { setErr(`Maximum bet is ${fmtUsd(maxUsd)}`); return; }
    if (usd > balance) { setErr('Not enough balance'); return; }
    setBusy(true);
    try { await onConfirm(epoch, bracket, usd); onClose(); }
    catch (e) { setErr(e?.message || 'Bet failed'); setBusy(false); }
  };

  return (
    <>
      <div className="fl-backdrop" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-grab" />
        <div className="fl-shhead">
          <div className="fl-shtitle">Round #{epoch}</div>
          <button className="fl-close" onClick={onClose}>×</button>
        </div>
        <div className={'fl-pickpill ' + meta.cls}>{meta.label} <span className="rng">{meta.range}</span></div>

        <div className="fl-amt">
          <span className="dollar">$</span>
          <input inputMode="decimal" placeholder="0" value={amt}
            onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div className="fl-chips">
          {chips.map((c) => (
            <button key={c} className={'fl-chip' + (usd === c ? ' on' : '')} onClick={() => setAmt(String(c))}>${c}</button>
          ))}
        </div>

        <div className="fl-est">
          <span className="l">EST. PAYOUT IF RIGHT</span>
          <span className="v">{usd > 0 ? `${fmtUsd(est)} · ${fmtMult(mult)}` : '—'}</span>
        </div>

        <button className="fl-cta" disabled={busy || usd <= 0} onClick={submit}>
          {busy ? 'Confirming…' : `Bet ${usd > 0 ? fmtUsd(usd) : ''} on ${meta.label}`}
        </button>
        {err && <div className="fl-sherr">{err}</div>}
        <div className="fl-shnote">
          Payout is a live estimate — it moves as others bet, and settles from the final pools.
          Fee is {(feeBps / 100).toFixed(0)}% of winnings only.
        </div>
      </div>
    </>
  );
}

function RoundsPopup({ open, onClose, userBets, recentRounds, liveRound, upcomingRounds, onClaim }) {
  if (!open) return null;
  const byEpoch = {};
  [...(recentRounds || []), liveRound, ...(upcomingRounds || [])].forEach(r => { if (r) byEpoch[r.epoch] = r; });
  const epochs = Object.keys(userBets || {}).map(Number).sort((a, b) => b - a);

  return (
    <>
      <div className="fl-backdrop" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-grab" />
        <div className="fl-shhead">
          <div className="fl-shtitle">My rounds</div>
          <button className="fl-close" onClick={onClose}>×</button>
        </div>
        {epochs.length === 0 && <div className="fl-rempty">No bets yet. Pick a bracket to get started.</div>}
        {epochs.map((ep) => {
          const bets = userBets[ep] || [];
          const r = byEpoch[ep];
          const outcome = r?.outcome || 'unresolved';
          const resolved = r && outcome !== 'unresolved';
          const won = resolved && bets.some(b => b.bracket === outcome);
          const claimable = won && bets.some(b => !b.claimed);
          const picks = [...new Set(bets.map(b => OUTCOME_LABEL[b.bracket]))].join(', ');
          const stake = bets.reduce((s, b) => s + b.amount, 0);
          const status = !resolved ? 'Pending'
            : outcome === 'tie' ? 'Flat — refunded'
            : won ? 'Won' : 'Lost';
          return (
            <div className="fl-rrow" key={ep}>
              <div>
                <div className="ep">#{ep} · {picks}</div>
                <div className="st">{fmtUsd(stake)} · {status}{resolved && ` · result ${OUTCOME_LABEL[outcome]}`}</div>
              </div>
              {claimable && <button className="claim" onClick={() => onClaim(ep)}>Collect</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ============================================================
// MAIN
// ============================================================
export default function Flipsy({ onConnectWallet }) {
  useEffect(() => { injectFlipsyStyles(); }, []);
  const wallet = useWallet();
  const {
    livePrice, liveRound, upcomingRounds, recentRounds, userBets, balance,
    balanceStatus, placeBet, claim, loading, programConfig, chainError,
  } = useFlipsy(wallet);

  const [flash, setFlash] = useState(null);
  const [betModal, setBetModal] = useState(null);
  const [roundsOpen, setRoundsOpen] = useState(false);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

  const feeBps = programConfig?.feeBps ?? 500;
  const minUsd = useMemo(() => {
    const lp = programConfig?.minBet, px = livePrice;
    return lp && px ? Math.max(1, Math.ceil((lp / 1e9) * px)) : 1;
  }, [programConfig, livePrice]);
  const maxUsd = useMemo(() => {
    const lp = programConfig?.maxBet, px = livePrice;
    return lp && px ? Math.floor((lp / 1e9) * px) : 25;
  }, [programConfig, livePrice]);

  // streak + pips from resolved recent rounds the user played
  const sortedRecent = useMemo(
    () => [...(recentRounds || [])].sort((a, b) => (b.epoch || 0) - (a.epoch || 0)),
    [recentRounds],
  );
  const pips = useMemo(() => {
    return [...(recentRounds || [])]
      .filter(r => r && r.outcome && r.outcome !== 'unresolved')
      .sort((a, b) => (a.epoch || 0) - (b.epoch || 0))
      .slice(-12)
      .map(r => (r.outcome.startsWith('up') ? 'u' : r.outcome.startsWith('down') ? 'd' : 't'));
  }, [recentRounds]);
  const streak = useMemo(() => {
    let s = 0;
    for (const r of sortedRecent) {
      if (!r || r.outcome === 'unresolved') continue;
      const bets = userBets[r.epoch];
      if (!bets || bets.length === 0) break;
      const won = bets.some(b => b.bracket === r.outcome) || r.outcome === 'tie';
      if (won) s++; else break;
    }
    return s;
  }, [sortedRecent, userBets]);

  const handlePick = useCallback((epoch, bracket) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    setBetModal({ epoch, bracket });
  }, [wallet.connected, onConnectWallet]);

  const handleConfirm = useCallback(async (epoch, bracket, usd) => {
    await placeBet(epoch, bracket, usd);
    setFlash({ type: 'success', msg: `✅ Bet placed on #${epoch}` });
  }, [placeBet]);

  const handleClaim = useCallback(async (epoch) => {
    try { await claim(epoch); setFlash({ type: 'success', msg: `💰 Collected #${epoch}` }); setRoundsOpen(false); }
    catch (e) { setFlash({ type: 'error', msg: e?.message || 'Collect failed' }); }
  }, [claim]);

  const claimableCount = useMemo(() => {
    let n = 0;
    const byEpoch = {};
    [...(recentRounds || []), liveRound].forEach(r => { if (r) byEpoch[r.epoch] = r; });
    for (const ep of Object.keys(userBets || {})) {
      const r = byEpoch[ep];
      if (r && r.outcome && r.outcome !== 'unresolved' && r.outcome !== 'tie') {
        if ((userBets[ep] || []).some(b => !b.claimed && b.bracket === r.outcome)) n++;
      }
    }
    return n;
  }, [userBets, recentRounds, liveRound]);

  const upcoming = upcomingRounds || [];
  const nothing = !liveRound && upcoming.length === 0;
  const betRound = betModal
    ? (liveRound?.epoch === betModal.epoch ? liveRound : upcoming.find(r => r.epoch === betModal.epoch)) || null
    : null;

  const renderBalance = () => {
    if (!wallet.connected) {
      return (
        <div className="fl-bal connect" onClick={() => onConnectWallet?.()}>
          <span className="fl-bal-v">Connect</span>
        </div>
      );
    }
    const fail = balanceStatus === 'fail';
    const load = balanceStatus === 'loading' || balanceStatus === 'idle';
    return (
      <div className={'fl-bal' + (fail ? ' warn' : '')}>
        <span className="fl-bal-l">BAL</span>
        <span className={'fl-bal-v' + (fail ? ' fail' : '')}>{fail ? 'RPC DOWN' : load ? '…' : fmtUsd(balance)}</span>
      </div>
    );
  };

  return (
    <div className="fl-page">
      {flash && <div className="fl-flashwrap"><div className={'fl-flash ' + flash.type}>{flash.msg}</div></div>}

      <div className="fl-inner">
        <header className="fl-hd">
          <div className="fl-br">
            <div className="fl-mascot">F</div>
            <div><div className="fl-bt">flipsy</div><div className="fl-bs">Solana Sentiment</div></div>
          </div>
          <div className="fl-hr">
            {streak > 0 && <div className="fl-streak">🔥 {streak}</div>}
            {renderBalance()}
          </div>
        </header>
        <div className="fl-tag"><span className="d" />Predict how far SOL moves · on-chain · settles in SOL</div>

        <div className="fl-prow">
          <div className="fl-ppill">
            <div className="fl-ptok">◎</div>
            <div><div className="fl-pv">{livePrice > 0 ? '$' + livePrice.toFixed(2) : '—'}</div><div className="fl-pl">SOL / USD</div></div>
          </div>
          {pips.length > 0 && (
            <div className="fl-pips">{pips.map((p, i) => <span key={i} className={'fl-pip ' + p} />)}</div>
          )}
        </div>

        {/* LIVE (watch-only) */}
        {liveRound && (
          <>
            <div className="fl-sec"><h3>Live now <em>#{liveRound.epoch}</em></h3><span className="r">watching</span></div>
            <LiveHero round={liveRound} livePrice={livePrice} myBets={userBets[liveRound.epoch]} feeBps={feeBps} />
          </>
        )}

        {/* UPCOMING (bettable) */}
        <div className="fl-sec"><h3>Upcoming rounds</h3><span className="r">bet ahead →</span></div>
        <div className="fl-hint">Pick how far SOL moves. Outer brackets are harder — they pay more.</div>

        {loading && nothing && <div className="fl-empty">Loading rounds…</div>}
        {!loading && nothing && chainError && (
          <div className="fl-empty err"><div className="i">⚠️</div><div className="t">Couldn’t load rounds</div><div>{chainError}</div></div>
        )}
        {!loading && nothing && !chainError && (
          <div className="fl-empty"><div className="i">⏳</div><div className="t">No rounds yet</div><div>New rounds start automatically.</div></div>
        )}

        <div className="fl-feed">
          {upcoming.map((r, i) => (
            <UpcomingCard key={r.epoch} round={r} isNext={i === 0} onPick={handlePick} feeBps={feeBps} />
          ))}
        </div>

        <div className="fl-tabs">
          <div className="fl-tab on">◆ Play</div>
          <div className="fl-tab disabled">🏆 Leaders<span className="fl-soon">soon</span></div>
          <div className="fl-tab" onClick={() => setRoundsOpen(true)}>
            📋 My Rounds{claimableCount > 0 ? ` · ${claimableCount}` : ''}
          </div>
        </div>
        <div className="fl-foot">Powered by Solana · Non-custodial · {(feeBps / 100).toFixed(0)}% fee on winnings only</div>
      </div>

      <BetModal
        open={!!betModal}
        epoch={betModal?.epoch}
        bracket={betModal?.bracket}
        round={betRound}
        feeBps={feeBps}
        balance={balance}
        minUsd={minUsd}
        maxUsd={maxUsd}
        onClose={() => setBetModal(null)}
        onConfirm={handleConfirm}
      />
      <RoundsPopup
        open={roundsOpen}
        onClose={() => setRoundsOpen(false)}
        userBets={userBets}
        recentRounds={recentRounds}
        liveRound={liveRound}
        upcomingRounds={upcomingRounds}
        onClaim={handleClaim}
      />
    </div>
  );
}
 