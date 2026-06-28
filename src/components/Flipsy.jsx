import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';
   
// ============================================================
// INLINE CSS — Wonderland with Solana-tinted accents · injected once
// ============================================================
const FLIPSY_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.fp-page{
  --ink:#2a2342; --ink-2:#6b6588; --ink-3:#a9a4c0;
  --pink:#ff5d7e; --mint:#13c98c; --lav:#6d4aff; --peach:#ffb13d;
  --sky:#6d4aff; --gold:#ffb13d;
  --sol-mint:#13c98c; --sol-mag:#ff5d7e; --sol-cyan:#6d4aff; --sol-purple:#6d4aff;
  --green:#13c98c; --red:#ff5d7e;
  --up:#13c98c; --upd:#0fae78; --down:#ff5d7e; --downd:#f23d63; --vio:#6d4aff; --viod:#5a37e6;
  --glass:#ffffff; --glass-strong:#faf9ff;
  --border:#e7e3f5;
  --hairline:#efecfa;

  position:relative;min-height:100dvh;width:100%;
  padding-bottom:calc(env(safe-area-inset-bottom) + 60px);overflow-x:hidden;
  color:var(--ink);
  font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  background:linear-gradient(170deg,#f1edfc 0%,#eaf4f1 52%,#f3eefb 100%);
  border-radius:0;
}
.fp-page *{box-sizing:border-box}

@keyframes fp-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes fp-spin{to{transform:rotate(360deg)}}
@keyframes fp-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes fp-card-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fp-live-glow{0%,100%{opacity:0.45}50%{opacity:0.7}}
@keyframes fp-price-tick{from{transform:translateY(2px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fp-pop{0%{transform:scale(0.92);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
@keyframes fp-banner-slide{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fp-modal-up{from{transform:translateX(-50%) translateY(100%);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
@keyframes fp-timer-urgent{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}


/* CLAIM BANNER */
.fp-claim-banner{
  position:sticky;top:0;z-index:50;
  padding:11px 16px;
  display:flex;align-items:center;justify-content:center;gap:8px;
  background:#0a0a0a;
  color:#fff;
  font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.8px;
  cursor:pointer;
  box-shadow:none;
  animation:fp-banner-slide .4s cubic-bezier(.16,1,.3,1);
}
.fp-claim-banner:active{opacity:.92}
.fp-claim-banner-count{
  background:rgba(255,255,255,.2);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:800;
}

/* TOP FLASH */
.fp-flash-top{margin:8px 18px 0;position:relative;z-index:10}
.fp-flash{
  padding:10px 14px;border-radius:12px;
  font-size:11px;font-weight:700;text-align:center;letter-spacing:0.3px;
  font-family:inherit;
  animation:fp-pop .35s cubic-bezier(.34,1.56,.64,1);
}
.fp-flash.error{background:rgba(224,54,79,.08);color:var(--red);border:1px solid rgba(224,54,79,.3)}
.fp-flash.success{background:rgba(22,163,74,.1);color:var(--green);border:1px solid rgba(22,163,74,.35)}

/* HEADER */
.fp-page-inner{position:relative;z-index:5}

.fp-header{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:14px 18px 12px;max-width:520px;margin:0 auto;
  border-bottom:1px solid var(--hairline);
}
.fp-brand{display:flex;align-items:center;gap:11px}
.fp-mascot{
  width:38px;height:38px;border-radius:10px;
  background:#0a0a0a;
  display:grid;place-items:center;
  font-family:inherit;font-style:normal;font-size:19px;font-weight:800;color:#fff;
  text-shadow:none;box-shadow:none;animation:none;
  flex-shrink:0;
}
.fp-brand-text .fp-title{
  font-family:inherit;font-style:normal;font-size:20px;font-weight:700;line-height:1;letter-spacing:-.02em;
  background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--ink);
  animation:none;
}
.fp-brand-text .fp-subtitle{
  margin-top:3px;font-family:inherit;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.1px;text-transform:uppercase;
}

.fp-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.fp-rounds-btn{
  display:flex;align-items:center;gap:6px;
  padding:8px 13px;border-radius:999px;
  background:var(--glass-strong);backdrop-filter:none;
  border:1px solid var(--border);color:var(--ink);
  font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.3px;
  cursor:pointer;transition:all .15s;
}
.fp-rounds-btn:hover{border-color:var(--ink);background:#f0f0f1}
.fp-rounds-btn.fp-has-claim{
  background:#0a0a0a;border-color:#0a0a0a;color:#fff;box-shadow:none;
}
.fp-rounds-btn-count{
  background:#0a0a0a;color:#fff;border-radius:50%;
  width:18px;height:18px;display:grid;place-items:center;
  font-size:10px;font-weight:800;
}
.fp-rounds-btn.fp-has-claim .fp-rounds-btn-count{background:#fff;color:#0a0a0a}
.fp-bal{
  display:flex;align-items:center;gap:6px;
  padding:8px 12px;border-radius:999px;
  background:var(--glass-strong);backdrop-filter:none;
  border:1px solid var(--border);
  cursor:default;
}
.fp-bal-l{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:1px}
.fp-bal-v{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums}
.fp-bal-v.fp-bal-loading{color:var(--ink-3)}
.fp-bal-v.fp-bal-fail{color:var(--red);font-family:inherit;font-size:10px;letter-spacing:0.4px;font-weight:800}
.fp-bal.fp-bal-warn{border-color:rgba(224,54,79,.35)}
.fp-bal-connect{cursor:pointer}
.fp-bal-connect .fp-bal-v{color:var(--ink);font-family:inherit;font-size:11px;font-weight:800;letter-spacing:0.4px}

/* ROUNDS LABEL */
.fp-rounds-head{
  padding:14px 20px 8px;max-width:520px;margin:0 auto;
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;
}
.fp-rounds-title{
  font-family:inherit;font-size:19px;line-height:1;color:var(--ink);letter-spacing:-.02em;
  margin:0;font-weight:700;
}
.fp-rounds-title em{
  font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--ink-2);
}
.fp-rounds-sub{
  font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:var(--ink-3);
  letter-spacing:1.1px;text-transform:uppercase;
}
.fp-rounds-sub .arrow{color:var(--ink-3)}

/* CAROUSEL */
.fp-carousel{
  display:flex;gap:12px;
  padding:10px 18px 22px;
  overflow-x:auto;overflow-y:visible;
  scroll-snap-type:x proximity;
  touch-action:pan-x pan-y;
  overscroll-behavior-x:contain;
  scrollbar-width:none;-ms-overflow-style:none;
  -webkit-overflow-scrolling:touch;
}
.fp-carousel::-webkit-scrollbar{display:none}

/* CARD */
.fp-card{
  flex-shrink:0;width:min(260px,76vw);min-height:420px;
  scroll-snap-align:center;
  background:#fff;backdrop-filter:none;
  border:1px solid var(--hairline);border-radius:18px;
  padding:13px;
  display:flex;flex-direction:column;
  box-shadow:0 1px 3px rgba(10,10,10,.05);
  position:relative;overflow:hidden;
  animation:fp-card-enter .45s cubic-bezier(.2,1,.4,1) backwards;
}
.fp-card-previous{opacity:0.7}
.fp-card-later{opacity:0.78}
.fp-card-loading{width:100%;max-width:320px;margin:0 auto;min-height:200px;justify-content:center;align-items:center;text-align:center;color:var(--ink-2);font-size:13px;font-weight:500;padding:24px}
.fp-card-empty{width:100%;max-width:340px;margin:0 auto;min-height:200px;justify-content:center;align-items:center;text-align:center;padding:24px}
.fp-card-empty-icon{font-size:28px;margin-bottom:10px;opacity:.7}
.fp-card-empty-title{font-family:inherit;font-style:normal;font-weight:700;font-size:18px;color:var(--ink);margin-bottom:6px;line-height:1.2}
.fp-card-empty-msg{font-size:12px;color:var(--ink-2);font-weight:500;line-height:1.5;word-break:break-word}
.fp-card-empty.err{border-color:rgba(224,54,79,.35);background:rgba(224,54,79,.04)}
.fp-card-empty.err .fp-card-empty-msg{color:var(--red);font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.3px}

/* LIVE CARD — solid black border instead of glow */
.fp-card-live{
  width:min(310px,86vw);min-height:485px;
  background:#fff;
  border-color:#0a0a0a;
  box-shadow:0 6px 20px rgba(10,10,10,.12);
}
.fp-card-livering{display:none}
.fp-card-live > *:not(.fp-card-livering){position:relative;z-index:1}

/* URGENT — last 10s */
.fp-card-urgent{
  background:#fff !important;
  border-color:var(--red) !important;
  box-shadow:0 6px 20px rgba(224,54,79,.18) !important;
}
.fp-card-urgent .fp-card-livering{display:none}

/* CARD HEAD */
.fp-card-head{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:11px;padding:0 2px;
}
.fp-card-badge{
  font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;
  padding:4px 9px;border-radius:6px;letter-spacing:0.8px;
}
.fp-card-badge.prev{background:var(--hairline);color:var(--ink-3)}
.fp-card-badge.live{background:#0a0a0a;color:#fff}
.fp-card-badge.live .d{display:inline-block;width:5px;height:5px;border-radius:50%;background:#16ff8a;margin-right:5px;animation:fp-pulse 1.4s ease-in-out infinite;vertical-align:middle}
.fp-card-badge.next{background:var(--glass-strong);color:var(--ink-2);border:1px solid var(--border)}
.fp-card-badge.later{background:var(--hairline);color:var(--ink-3)}
.fp-card-urgent .fp-card-badge.live{background:var(--red);color:#fff}
.fp-card-urgent .fp-card-badge.live .d{background:#fff}
.fp-card-epoch{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-3);font-weight:700;letter-spacing:0.4px}

/* SIDE BUTTONS — UP green / DOWN red */
.fp-card-side{
  width:100%;padding:13px 15px;border-radius:13px;
  border:1.5px solid;font-family:inherit;font-weight:700;
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  cursor:pointer;transition:transform .2s;
}
.fp-card-side:hover:not(:disabled){transform:translateY(-1px)}
.fp-card-side:active:not(:disabled){transform:scale(.98)}
.fp-card-side:disabled{cursor:not-allowed}
.fp-card-side-icon{font-size:18px;line-height:1;font-weight:900;width:22px;text-align:center}
.fp-card-side-label{flex:1;text-align:center;font-family:inherit;font-size:13px;font-weight:800;letter-spacing:0.08em}
.fp-card-side-mult{font-family:ui-monospace,Menlo,monospace;font-style:normal;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}

.fp-card-long{
  background:rgba(22,163,74,.07);
  border-color:rgba(22,163,74,.45);color:var(--green);
}
.fp-card-long.active{background:var(--green);border-color:var(--green);color:#fff;box-shadow:none}
.fp-card-long.won{background:var(--green);border-color:var(--green);color:#fff}
.fp-card-long.lost{background:rgba(22,163,74,.04);border-color:rgba(22,163,74,.15);color:var(--ink-3)}

.fp-card-short{
  background:rgba(224,54,79,.06);
  border-color:rgba(224,54,79,.45);color:var(--red);
}
.fp-card-short.active{background:var(--red);border-color:var(--red);color:#fff;box-shadow:none}
.fp-card-short.won{background:var(--red);border-color:var(--red);color:#fff}
.fp-card-short.lost{background:rgba(224,54,79,.04);border-color:rgba(224,54,79,.15);color:var(--ink-3)}

/* MIDDLE PANEL */
.fp-card-mid{
  margin:9px 0;padding:13px;border-radius:13px;text-align:center;
  background:var(--glass-strong);border:1px solid var(--hairline);
  flex:1;display:flex;flex-direction:column;justify-content:center;
}
.fp-card-live .fp-card-mid{background:var(--glass-strong);border-color:var(--hairline)}
.fp-card-urgent .fp-card-mid{background:rgba(224,54,79,.04);border-color:rgba(224,54,79,.2)}

.fp-mid-label{
  font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:7px;
}

/* BIG LIVE PRICE — mono sans instead of serif */
.fp-mid-price{
  font-family:ui-monospace,Menlo,monospace;font-style:normal;font-weight:700;
  font-size:40px;line-height:0.95;letter-spacing:-.03em;color:var(--ink);
  font-variant-numeric:tabular-nums;
}

.fp-mid-delta{
  display:inline-block;margin-top:8px;
  padding:3px 11px;border-radius:6px;
  font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.3px;
  font-variant-numeric:tabular-nums;
}
.fp-mid-delta.up{background:rgba(22,163,74,.12);color:var(--green);border:1px solid rgba(22,163,74,.3)}
.fp-mid-delta.down{background:rgba(224,54,79,.1);color:var(--red);border:1px solid rgba(224,54,79,.3)}

.fp-mid-divider{height:1px;margin:11px 0;background:var(--hairline)}

.fp-mid-row{
  display:flex;justify-content:space-between;
  font-family:ui-monospace,Menlo,monospace;font-size:11px;
  color:var(--ink-3);margin-top:5px;letter-spacing:0.3px;
}
.fp-mid-row-val{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.fp-mid-row-val.gold{color:var(--gold)}

.fp-mid-timer{
  margin-top:13px;
  font-family:ui-monospace,Menlo,monospace;font-size:28px;font-weight:700;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;letter-spacing:-.02em;
}
.fp-mid-timer.urgent{
  color:var(--red);font-style:normal;
  animation:fp-timer-urgent .5s ease-in-out infinite;
}

.fp-mid-pool{
  font-family:ui-monospace,Menlo,monospace;font-style:normal;font-weight:700;font-size:34px;line-height:1;letter-spacing:-.025em;
  background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--ink);
  font-variant-numeric:tabular-nums;
}

.fp-mid-payout-preview{
  font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);
  margin-top:6px;line-height:1.5;
}
.fp-mid-payout-preview b{font-weight:700;color:var(--ink)}
.fp-mid-payout-preview .l{color:var(--green);font-weight:700}
.fp-mid-payout-preview .s{color:var(--red);font-weight:700}

.fp-mid-starts{
  margin-top:10px;
  font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-3);letter-spacing:0.3px;
}
.fp-mid-starts b{
  color:var(--ink);font-family:ui-monospace,Menlo,monospace;font-style:normal;
  font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;
}

.fp-mid-later-icon{font-size:32px;margin:14px 0 8px;opacity:0.55}

.fp-mid-outcome{
  margin-top:8px;display:inline-block;
  padding:6px 14px;border-radius:8px;
  font-family:inherit;font-size:11px;font-weight:800;letter-spacing:0.8px;
}
.fp-mid-outcome.long{background:rgba(22,163,74,.12);color:var(--green);border:1px solid rgba(22,163,74,.35)}
.fp-mid-outcome.short{background:rgba(224,54,79,.1);color:var(--red);border:1px solid rgba(224,54,79,.35)}
.fp-mid-outcome.tie{background:var(--hairline);color:var(--ink-2);border:1px solid var(--border)}

.fp-mid-claim{
  margin-top:10px;width:100%;padding:11px;border-radius:12px;
  background:#0a0a0a;
  border:none;color:#fff;
  font-family:inherit;font-weight:800;font-size:12px;letter-spacing:0.6px;
  cursor:pointer;box-shadow:none;
  transition:opacity .15s;
}
.fp-mid-claim:hover{opacity:.9}

/* USER POSITION */
.fp-card-position{
  margin-top:9px;padding:8px 14px;border-radius:11px;
  display:flex;justify-content:space-between;align-items:center;
  font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.3px;
  animation:fp-pop .3s cubic-bezier(.34,1.56,.64,1);
}
.fp-card-position-heads{background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.35);color:var(--green)}
.fp-card-position-tails{background:rgba(224,54,79,.08);border:1px solid rgba(224,54,79,.35);color:var(--red)}

/* FOOTER */
.fp-footer{
  max-width:520px;margin:14px auto 0;
  padding:8px 22px;text-align:center;
  font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-3);font-weight:600;
  letter-spacing:0.2px;
}

/* BLOCK SCREEN */
.fp-block-wrap{
  min-height:70dvh;display:flex;align-items:center;justify-content:center;
  padding:40px 22px;position:relative;z-index:5;
}
.fp-block-card{
  max-width:440px;width:100%;
  background:#fff;backdrop-filter:none;
  border:1px solid var(--hairline);border-radius:20px;
  padding:36px 28px;text-align:center;
  box-shadow:0 4px 20px rgba(10,10,10,.06);
}
.fp-block-icon{
  width:56px;height:56px;margin:0 auto 18px;border-radius:16px;
  background:#0a0a0a;
  display:grid;place-items:center;color:#fff;font-size:24px;
  box-shadow:none;
}
.fp-block-title{
  margin:0 0 10px;
  font-family:inherit;font-size:24px;font-weight:700;color:var(--ink);
  letter-spacing:-.02em;
}
.fp-block-title em{
  font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--ink-2);
}
.fp-block-msg{margin:0 0 12px;font-size:13px;color:var(--ink-2);line-height:1.6;font-weight:500}
.fp-block-sub{margin:0;font-size:11px;color:var(--ink-3);font-style:normal}

/* ROUNDS POPUP (sheet) */
.fp-sheet-backdrop{
  position:fixed;inset:0;z-index:200;
  background:rgba(10,10,10,0.35);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
}
.fp-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:201;
  max-height:80dvh;display:flex;flex-direction:column;overflow:hidden;
  background:#fff;
  border-top:1px solid var(--border);
  border-radius:22px 22px 0 0;
  box-shadow:0 -12px 50px rgba(10,10,10,.18);
  font-family:inherit;
  animation:fp-modal-up .3s cubic-bezier(.16,1,.3,1);
}
.fp-grabber{width:40px;height:4px;border-radius:99px;background:var(--border);margin:10px auto 16px}
.fp-sheet-head{flex-shrink:0;padding:0 22px 14px}
.fp-sheet-head-row{display:flex;align-items:center;justify-content:space-between}
.fp-sheet-title{
  font-family:inherit;font-size:20px;font-weight:700;color:var(--ink);letter-spacing:-.02em;line-height:1;
}
.fp-sheet-title em{font-style:normal;background:none;-webkit-background-clip:initial;background-clip:initial;color:var(--ink-2)}
.fp-close-btn{
  width:34px;height:34px;border-radius:50%;
  background:var(--glass-strong);border:1px solid var(--border);
  color:var(--ink);font-size:16px;cursor:pointer;font-family:inherit;
  display:grid;place-items:center;transition:all .15s;
}
.fp-close-btn:hover{background:#f0f0f1;border-color:var(--ink)}

.fp-sheet-body{flex:1;overflow-y:auto;padding:0 22px 14px}
.fp-sheet-empty{text-align:center;padding:40px 0;color:var(--ink-3);font-size:13px;font-weight:500}

.fp-round-row{
  display:flex;align-items:center;gap:12px;
  padding:12px 14px;margin-bottom:8px;border-radius:14px;
  background:var(--glass-strong);border:1px solid;
}
.fp-round-row.claim{border-color:#0a0a0a;background:#fafafa}
.fp-round-row.live{border-color:rgba(22,163,74,.4)}
.fp-round-row.pending{border-color:rgba(47,107,255,.3)}
.fp-round-row.won{border-color:rgba(22,163,74,.3)}
.fp-round-row.lost{border-color:rgba(224,54,79,.25)}
.fp-round-row.tie{border-color:var(--border)}
.fp-round-row.expired{border-color:var(--hairline)}

.fp-round-epoch{min-width:42px;text-align:center}
.fp-round-epoch .l{font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3);font-weight:700;letter-spacing:1px}
.fp-round-epoch .n{font-family:ui-monospace,Menlo,monospace;font-style:normal;font-size:16px;font-weight:700;color:var(--ink);line-height:1.1}

.fp-round-mid{flex:1;min-width:0}
.fp-round-prices{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.fp-round-bets{margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.fp-round-bets .l{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--green);font-weight:700;font-variant-numeric:tabular-nums}
.fp-round-bets .s{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--red);font-weight:700;font-variant-numeric:tabular-nums}
.fp-round-warn{margin-top:3px;font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--gold);font-weight:700}

.fp-round-right{text-align:right;flex-shrink:0}
.fp-round-status{
  font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;
  padding:5px 10px;border-radius:8px;letter-spacing:0.4px;display:inline-block;
}
.fp-round-status.live{background:rgba(22,163,74,.12);color:var(--green);border:1px solid rgba(22,163,74,.3)}
.fp-round-status.pending{background:rgba(47,107,255,.1);color:#1e52cc;border:1px solid rgba(47,107,255,.3)}
.fp-round-status.won{background:rgba(22,163,74,.12);color:var(--green);border:1px solid rgba(22,163,74,.3)}
.fp-round-status.lost{background:rgba(224,54,79,.1);color:var(--red);border:1px solid rgba(224,54,79,.3)}
.fp-round-status.tie{background:var(--hairline);color:var(--ink-2);border:1px solid var(--border)}
.fp-round-status.expired{background:var(--hairline);color:var(--ink-3);border:1px solid var(--hairline)}

.fp-round-claim-btn{
  background:#0a0a0a;border:none;border-radius:9px;
  padding:7px 12px;color:#fff;font-family:inherit;
  font-weight:800;font-size:11px;letter-spacing:0.4px;cursor:pointer;box-shadow:none;
}
.fp-round-claim-sub{margin-top:3px;font-family:ui-monospace,Menlo,monospace;font-size:9px;color:var(--ink-3)}

.fp-sheet-note{
  margin-top:8px;padding:10px 14px;border-radius:12px;
  background:var(--glass-strong);border:1px solid var(--hairline);
  font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-2);
  line-height:1.5;text-align:center;
}
.fp-sheet-note b{color:var(--gold);font-weight:800}

/* BET MODAL (sheet) */
.fp-bet-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:301;
  display:flex;flex-direction:column;overflow:hidden;
  background:#fff;
  border-top:1px solid var(--border);
  border-radius:22px 22px 0 0;
  padding:0 22px calc(env(safe-area-inset-bottom) + 22px);
  font-family:inherit;
  animation:fp-modal-up .3s cubic-bezier(.16,1,.3,1);
  box-shadow:0 -12px 50px rgba(10,10,10,.18);
}

.fp-bet-head{display:flex;align-items:center;justify-content:space-between;padding-top:16px;margin-bottom:16px}
.fp-bet-head-left{display:flex;align-items:center;gap:10px;min-width:0}
.fp-bet-side-pill{
  padding:6px 14px;border-radius:999px;
  font-family:inherit;font-weight:800;font-size:13px;letter-spacing:0.6px;
  border:1px solid;
}
.fp-bet-side-pill.long{background:rgba(22,163,74,.12);color:var(--green);border-color:rgba(22,163,74,.45)}
.fp-bet-side-pill.short{background:rgba(224,54,79,.1);color:var(--red);border-color:rgba(224,54,79,.45)}
.fp-bet-epoch{color:var(--ink-3);font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.4px}

.fp-bet-amount{
  background:var(--glass-strong);border:1px solid var(--border);
  border-radius:16px;padding:14px 18px;margin-bottom:12px;transition:border-color .15s;
}
.fp-bet-amount.long{border-color:rgba(22,163,74,.3)}
.fp-bet-amount.short{border-color:rgba(224,54,79,.3)}
.fp-bet-amount.err{border-color:rgba(224,54,79,.45)}
.fp-bet-amount-label{
  font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px;
}
.fp-bet-amount-row{display:flex;align-items:center;gap:8px}
.fp-bet-dollar{font-family:ui-monospace,Menlo,monospace;font-size:28px;font-weight:600;color:var(--ink-3);line-height:1}
.fp-bet-input{
  flex:1;background:transparent;border:none;outline:none;
  font-family:ui-monospace,Menlo,monospace;font-size:34px;font-weight:700;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;min-width:0;width:100%;
}
.fp-bet-input:disabled{opacity:.6}
.fp-bet-bal{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-3);font-weight:600;white-space:nowrap}

.fp-bet-chips{display:flex;gap:8px;margin-bottom:14px}
.fp-bet-chip{
  flex:1;padding:9px 0;border-radius:999px;
  background:var(--glass-strong);border:1px solid var(--border);color:var(--ink-2);
  font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;
}
.fp-bet-chip:hover{background:#f0f0f1;border-color:var(--ink)}
.fp-bet-chip.active.long{background:var(--green);border-color:var(--green);color:#fff}
.fp-bet-chip.active.short{background:var(--red);border-color:var(--red);color:#fff}
.fp-bet-chip:disabled{cursor:not-allowed;opacity:.5}

.fp-bet-est{
  background:var(--glass-strong);border:1px solid var(--border);
  border-radius:14px;padding:12px 16px;margin-bottom:14px;
  display:flex;justify-content:space-between;align-items:center;gap:10px;
}
.fp-bet-est-block{}
.fp-bet-est-l{font-family:ui-monospace,Menlo,monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:1.2px;margin-bottom:2px}
.fp-bet-est-v{font-family:ui-monospace,Menlo,monospace;font-style:normal;font-size:22px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.fp-bet-est-v.long{color:var(--green)}
.fp-bet-est-v.short{color:var(--red)}
.fp-bet-est-v.gold{color:var(--gold)}
.fp-bet-est-r{text-align:right}

.fp-bet-status{
  display:flex;align-items:center;justify-content:center;gap:10px;
  padding:10px;margin-bottom:10px;font-size:13px;font-weight:700;
}
.fp-bet-status.long{color:var(--green)}
.fp-bet-status.short{color:var(--red)}
.fp-bet-spinner{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:fp-spin .7s linear infinite}

.fp-bet-success{text-align:center;padding:12px;margin-bottom:10px;color:var(--green);font-size:14px;font-weight:800;animation:fp-pop .3s cubic-bezier(.34,1.56,.64,1)}
.fp-bet-error{
  padding:10px 14px;margin-bottom:10px;border-radius:12px;
  background:rgba(224,54,79,.08);border:1px solid rgba(224,54,79,.3);
  color:var(--red);font-size:12px;font-weight:700;
}

.fp-bet-cta{
  width:100%;padding:16px;border-radius:999px;border:none;
  font-family:inherit;font-size:16px;letter-spacing:-.01em;
  color:#fff;cursor:pointer;font-weight:700;
  transition:opacity .15s,transform .15s;position:relative;overflow:hidden;
}
.fp-bet-cta.long{background:var(--green);color:#fff;box-shadow:none}
.fp-bet-cta.short{background:var(--red);color:#fff;box-shadow:none}
.fp-bet-cta:hover:not(:disabled){opacity:.9}
.fp-bet-cta:disabled{background:var(--glass-strong);color:var(--ink-3);border:1px solid var(--border);box-shadow:none;cursor:not-allowed}

.fp-bet-foot{
  margin-top:10px;text-align:center;
  font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--ink-3);font-weight:600;letter-spacing:0.3px;
}

/* ===== Flipsy v7 layout (fx-*) ===== */
.fx-page{font-family:'Space Grotesk',sans-serif}
.fx-inner{max-width:480px;margin:0 auto;padding:0 0 10px}
.fx-claim{display:flex;align-items:center;gap:9px;justify-content:center;margin:12px 14px 4px;padding:11px 14px;border-radius:16px;background:linear-gradient(135deg,#6d4aff,#8b6bff);color:#fff;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.04em;cursor:pointer;box-shadow:0 8px 20px rgba(109,74,255,.32)}
.fx-claim-c{background:rgba(255,255,255,.25);border-radius:999px;padding:2px 9px}
.fx-flash-wrap{position:sticky;top:8px;z-index:60;display:flex;justify-content:center;pointer-events:none;padding:6px 14px 0}
.fx-flash{pointer-events:auto;padding:10px 16px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#fff;box-shadow:0 10px 26px rgba(0,0,0,.16)}
.fx-flash.success{background:linear-gradient(135deg,#1ad99a,#12b884)}
.fx-flash.error{background:linear-gradient(135deg,#ff6f8d,#f2456a)}

.fx-hd{display:flex;align-items:center;justify-content:space-between;padding:15px 16px 9px}
.fx-br{display:flex;align-items:center;gap:10px}
.fx-mascot{width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#8b6bff,#6d4aff 60%,#5a37e6);display:grid;place-items:center;font-weight:700;font-size:18px;color:#fff;box-shadow:0 5px 16px rgba(109,74,255,.4),inset 0 0 0 2px rgba(255,255,255,.25)}
.fx-bt{font-size:21px;font-weight:700;letter-spacing:-.02em;line-height:1;color:#36284f}
.fx-bs{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:#8a85a6;margin-top:3px}
.fx-hr{display:flex;align-items:center;gap:8px}
.fx-streak{display:flex;align-items:center;gap:4px;background:linear-gradient(135deg,#ffc861,#ff9d3c);border-radius:999px;padding:7px 12px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:#5a3500;box-shadow:0 5px 14px rgba(255,157,60,.38)}
.fx-bal{display:flex;flex-direction:column;align-items:flex-end;background:#fff;border-radius:16px;padding:6px 12px;box-shadow:0 4px 12px rgba(80,60,160,.1)}
.fx-bal-connect{cursor:pointer;background:linear-gradient(135deg,#6d4aff,#8b6bff)}
.fx-bal-connect .fx-bal-v{color:#fff;font-size:13px}
.fx-bal-l{font-family:'JetBrains Mono',monospace;font-size:7px;letter-spacing:.12em;color:var(--ink-3)}
.fx-bal-v{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--vio)}
.fx-bal-v.fail{color:var(--down)}
.fx-bal.warn{box-shadow:0 0 0 1.5px var(--down) inset,0 4px 12px rgba(80,60,160,.1)}

.fx-prow{display:flex;align-items:center;gap:9px;padding:4px 16px 9px}
.fx-ppill{display:flex;align-items:center;gap:10px;background:#fff;border-radius:999px;padding:6px 16px 6px 6px;box-shadow:0 5px 16px rgba(80,60,160,.12)}
.fx-ptok{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6d4aff,#13c98c);display:grid;place-items:center;color:#fff;font-weight:700;font-size:14px}
.fx-pv{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--ink);line-height:1}
.fx-pl{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.1em;color:var(--ink-3);margin-top:2px}

.fx-fclbl{padding:6px 16px 6px;font-family:'JetBrains Mono',monospace;font-size:8.5px;letter-spacing:.12em;color:#7a7498;font-weight:700}
.fx-fcrow{display:flex;gap:8px;overflow-x:auto;padding:0 16px 4px;-webkit-overflow-scrolling:touch}
.fx-fcrow::-webkit-scrollbar{display:none}
.fx-fcell{flex:0 0 auto;min-width:62px;background:#fff;border-radius:17px;padding:9px 12px;box-shadow:0 4px 12px rgba(80,60,160,.08)}
.fx-ft{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.06em;color:var(--ink-3);margin-bottom:3px}
.fx-fp{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--ink);line-height:1}
.fx-fd{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;margin-top:3px}
.fx-fd.u{color:var(--up)} .fx-fd.n{color:var(--ink-3)} .fx-fd.d{color:var(--down)}

.fx-hist{display:flex;align-items:center;gap:7px;padding:9px 17px 4px}
.fx-hl{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.1em;color:#7a7498;font-weight:700}
.fx-pips{display:flex;gap:3px}
.fx-pip{width:9px;height:9px;border-radius:50%}
.fx-pip.u{background:var(--up);box-shadow:0 2px 5px rgba(19,201,140,.5)}
.fx-pip.d{background:var(--down);opacity:.6}
.fx-pip.t{background:var(--ink-3);opacity:.5}
.fx-wr{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--up);font-weight:700}

.fx-rh{display:flex;align-items:baseline;justify-content:space-between;padding:10px 17px 8px}
.fx-rh h3{font-size:17px;font-weight:700;color:#36284f;margin:0}
.fx-rh em{font-style:normal;font-family:'JetBrains Mono',monospace;color:var(--vio)}
.fx-sw{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8a85a6}

.fx-wrap{padding:0 15px}
.fx-lcard{background:#fff;border-radius:30px;padding:13px;box-shadow:0 16px 40px rgba(80,55,160,.18)}
.fx-lhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;padding:2px 4px}
.fx-lv{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;color:var(--vio);letter-spacing:.03em}
.fx-dot{width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 8px var(--up);animation:fx-pl 1.3s infinite}
@keyframes fx-pl{50%{opacity:.4}}
.fx-ep{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink-3);margin-left:6px}
.fx-tm{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--down)}
.fx-tm.urgent{animation:fx-pl .6s infinite}
.fx-big{width:100%;border:none;border-radius:20px;padding:15px 18px;display:flex;align-items:center;gap:9px;cursor:pointer;color:#fff;font-family:'Space Grotesk',sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.08)}
.fx-big:active{transform:translateY(1px)}
.fx-ic{font-size:19px;font-weight:700}
.fx-lb{font-size:16px;font-weight:700;letter-spacing:.02em}
.fx-ml{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700}
.fx-big.up{background:linear-gradient(135deg,#1ad99a,#12b884)}
.fx-big.down{background:linear-gradient(135deg,#ff6f8d,#f2456a)}
.fx-panel{background:linear-gradient(180deg,#fbfaff,#f4f1fc);border-radius:24px;padding:14px 15px;margin:9px 0;box-shadow:inset 0 0 0 1.5px rgba(109,74,255,.1)}
.fx-plab{display:flex;align-items:center;justify-content:space-between}
.fx-plab .fx-l{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.12em;color:var(--ink-2);font-weight:700}
.fx-co{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink-3)}
.fx-prow2{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px}
.fx-cprice{font-family:'JetBrains Mono',monospace;font-size:25px;font-weight:700;letter-spacing:-.01em}
.fx-cdelta{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#fff;border-radius:999px;padding:7px 13px;white-space:nowrap}
.fx-spk{display:block;width:100%;height:50px;margin:9px 0 6px}
.fx-metrow{display:flex;gap:8px;margin-top:4px}
.fx-met{flex:1;background:#fff;border-radius:14px;padding:8px 11px;box-shadow:0 2px 8px rgba(80,60,160,.06)}
.fx-ml2{font-family:'JetBrains Mono',monospace;font-size:7.5px;letter-spacing:.1em;color:var(--ink-3)}
.fx-mv{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--ink);margin-top:2px}
.fx-mv.g{color:var(--gold)}
.fx-sent{margin:11px 2px 2px}
.fx-sl{display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;margin-bottom:4px}
.fx-sl .su{color:var(--up)} .fx-sl .sd{color:var(--down)}
.fx-bar{height:8px;border-radius:999px;overflow:hidden;background:var(--down)}
.fx-bar .fx-f{height:100%;background:var(--up);border-radius:999px 0 0 999px}
.fx-pos{display:flex;justify-content:space-between;margin-top:10px;padding:9px 13px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;background:rgba(19,201,140,.12);color:var(--upd)}

.fx-empty{background:#fff;border-radius:24px;padding:30px 18px;text-align:center;box-shadow:0 10px 26px rgba(80,55,160,.12);font-family:'JetBrains Mono',monospace;color:var(--ink-2);font-size:12px}
.fx-empty-i{font-size:30px;margin-bottom:8px}
.fx-empty-t{font-weight:700;color:var(--ink);font-size:14px;margin-bottom:4px;font-family:'Space Grotesk',sans-serif}
.fx-empty-m{font-size:11px;color:var(--ink-3)}
.fx-empty.err .fx-empty-t{color:var(--down)}

.fx-utitle{display:flex;align-items:baseline;justify-content:space-between;padding:18px 17px 9px}
.fx-utitle h4{font-size:14px;font-weight:700;color:#36284f;margin:0}
.fx-c{font-family:'JetBrains Mono',monospace;font-size:9px;color:#8a85a6}
.fx-ugrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 15px}
.fx-ut{background:#fff;border-radius:22px;padding:12px;box-shadow:0 6px 16px rgba(80,55,160,.1)}
.fx-uh{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.fx-ue{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--vio)}
.fx-ub{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.08em;color:#fff;background:linear-gradient(135deg,#6d4aff,#8b6bff);border-radius:999px;padding:3px 9px}
.fx-us2{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-3)}
.fx-us{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-2);margin-bottom:9px}
.fx-us b{color:var(--ink)} .fx-us .g{color:var(--gold);font-weight:700}
.fx-ubt{display:flex;gap:7px;margin-top:8px}
.fx-mini{flex:1;border-radius:14px;padding:9px;font-size:11px;font-weight:700;border:none;cursor:pointer;color:#fff;font-family:'Space Grotesk',sans-serif}
.fx-mini.u{background:linear-gradient(135deg,#1ad99a,#12b884)}
.fx-mini.d{background:linear-gradient(135deg,#ff6f8d,#f2456a)}

.fx-tabs{display:flex;gap:8px;padding:18px 15px 4px}
.fx-tab{flex:1;text-align:center;padding:12px;border-radius:18px;font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace;background:#fff;color:#8a85a6;box-shadow:0 5px 14px rgba(80,55,160,.08);cursor:pointer;position:relative}
.fx-tab.on{background:linear-gradient(135deg,#6d4aff,#8b6bff);color:#fff;box-shadow:0 8px 18px rgba(109,74,255,.34)}
.fx-tab.disabled{opacity:.55;cursor:default}
.fx-soon{font-size:7px;letter-spacing:.06em;background:var(--ink-3);color:#fff;border-radius:999px;padding:1px 5px;margin-left:5px;vertical-align:middle}
.fx-footer{text-align:center;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink-3);padding:18px 24px 8px;line-height:1.5}
`;

function injectFlipsyStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('flipsy-inline-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'flipsy-inline-styles';
  tag.textContent = FLIPSY_CSS;
  document.head.appendChild(tag);
}

const BLOCKED_COUNTRIES = [
  // Comprehensively sanctioned / high-risk jurisdictions (baseline).
  // NOTE: prediction-market & online-gaming rules vary widely by country and by
  // US state — review and expand this list with counsel before a public launch.
  'US', 'IR', 'KP', 'SY', 'CU',
];
const GEO_BYPASS_WALLETS = new Set([
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
]);
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 25;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600; // 6 hours
const NET_MULT = 0.75;

// Illustrative SOL price forecasts for the strip. These are PLACEHOLDER values —
// replace with a live feed from your backend (they will otherwise go stale).
// Set SOL_FORECASTS = [] to hide the forecast strip entirely.
const SOL_FORECASTS = [
  { t: 'TODAY', p: '$72.49', d: '+2.4%', k: 'u' },
  { t: 'TMRW',  p: '$73.28', d: '+3.5%', k: 'u' },
  { t: '7D',    p: '$76.55', d: '+8.1%', k: 'u' },
  { t: '30D',   p: '$75.42', d: '+6.5%', k: 'u' },
  { t: 'EOY',   p: '$80.00', d: '+13%',  k: 'u' },
];

async function checkGeo() {
  const sources = [
    { url: 'https://ipapi.co/json/', field: 'country_code' },
    { url: 'https://api.country.is/', field: 'country' },
  ];
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(src.url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const cc = (data[src.field] || '').toUpperCase();
      if (cc) return { country: cc, blocked: BLOCKED_COUNTRIES.includes(cc) };
    } catch {}
  }
  // Fail CLOSED: if geo can't be determined (both sources failed, timed out, or
  // were blocked by an ad-blocker / VPN), deny rather than allow. Wallets in
  // GEO_BYPASS_WALLETS still pass, so testing isn't affected.
  return { country: 'UNKNOWN', blocked: true };
}

function BlockScreen({ title, message, sub }) {
  return (
    <div className="fp-page">
      <div className="fp-block-wrap">
        <div className="fp-block-card">
          <div className="fp-block-icon">🔒</div>
          <h2 className="fp-block-title">{title}</h2>
          <p className="fp-block-msg">{message}</p>
          {sub && <p className="fp-block-sub">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ROUNDS HISTORY POPUP
// ============================================================
function RoundsPopup({ open, onClose, liveRound, upcomingRounds, recentRounds, userBets, onClaim, claimForfeitDelay }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    if (round.outcome === 'unresolved') return false;
    const bets = getBetsForEpoch(round.epoch);
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + claimForfeitDelay;
    if (expired) return false;
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  const allRounds = [
    ...(liveRound ? [liveRound] : []),
    ...(upcomingRounds || []),
    ...(recentRounds || []),
  ];
  const seen = new Set();
  const rounds = allRounds
    .filter(r => {
      if (!r || seen.has(r.epoch)) return false;
      if (getBetsForEpoch(r.epoch).length === 0) return false;
      seen.add(r.epoch);
      return true;
    })
    .sort((a, b) => b.epoch - a.epoch);

  const forfeitLabel = claimForfeitDelay >= 3600
    ? Math.round(claimForfeitDelay / 3600) + ' hours'
    : Math.round(claimForfeitDelay / 60) + ' minutes';

  return (
    <>
      <div onClick={onClose} className="fp-sheet-backdrop"/>
      <div className="fp-sheet">
        <div className="fp-grabber"/>
        <div className="fp-sheet-head">
          <div className="fp-sheet-head-row">
            <div className="fp-sheet-title">My <em>Rounds</em></div>
            <button onClick={onClose} className="fp-close-btn">✕</button>
          </div>
        </div>

        <div className="fp-sheet-body">
          {rounds.length === 0 && (
            <div className="fp-sheet-empty">No rounds yet</div>
          )}
          {rounds.map(r => {
            const bets = getBetsForEpoch(r.epoch);
            const canClaim = isClaimable(r);
            const deadlineTs = r.resolvedAt > 0 ? r.resolvedAt + claimForfeitDelay : 0;
            const minutesLeft = deadlineTs > 0 ? Math.max(0, Math.floor((deadlineTs - nowTs) / 60)) : 0;
            const hoursLeft = Math.floor(minutesLeft / 60);
            const expired = deadlineTs > 0 && nowTs > deadlineTs;
            const hasUnclaimedWin = bets.some(b => !b.claimed && (r.outcome === b.side || r.outcome === 'tie'));
            const isLiveOrPending = r.outcome === 'unresolved';

            const longTotal = bets.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
            const shortTotal = bets.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);
            const won = !isLiveOrPending && (
              (r.outcome === 'heads' && longTotal > 0) ||
              (r.outcome === 'tails' && shortTotal > 0)
            );
            const lost = !isLiveOrPending && !won && r.outcome !== 'tie';
            const tie = r.outcome === 'tie';

            let statusKey, statusLabel;
            if (isLiveOrPending) {
              const isLive = liveRound && liveRound.epoch === r.epoch;
              statusKey = isLive ? 'live' : 'pending';
              statusLabel = isLive ? '● LIVE' : '⏱ PENDING';
            } else if (won)  { statusKey = 'won';  statusLabel = '✓ WON'; }
            else if (lost)   { statusKey = 'lost'; statusLabel = '💔 LOST'; }
            else if (tie)    { statusKey = 'tie';  statusLabel = '= TIE'; }
            else             { statusKey = 'tie';  statusLabel = '= TIE'; }

            const rowKind = canClaim ? 'claim'
              : isLiveOrPending ? statusKey
              : statusKey;

            const formatTimeLeft = () =>
              hoursLeft > 0 ? `${hoursLeft}h left` : `${minutesLeft}m left`;

            return (
              <div key={r.epoch} className={'fp-round-row ' + rowKind}>
                <div className="fp-round-epoch">
                  <div className="l">RND</div>
                  <div className="n">#{r.epoch}</div>
                </div>

                <div className="fp-round-mid">
                  {!isLiveOrPending ? (
                    <div className="fp-round-prices">
                      ${r.lockPrice.toFixed(2)} → ${r.closePrice.toFixed(2)}
                    </div>
                  ) : r.lockPrice > 0 ? (
                    <div className="fp-round-prices">Locked at ${r.lockPrice.toFixed(2)}</div>
                  ) : (
                    <div className="fp-round-prices">Awaiting start</div>
                  )}
                  <div className="fp-round-bets">
                    {longTotal > 0 && (<span className="l">↑ ${longTotal.toFixed(2)}</span>)}
                    {shortTotal > 0 && (<span className="s">↓ ${shortTotal.toFixed(2)}</span>)}
                  </div>
                  {canClaim && hoursLeft < 2 && (
                    <div className="fp-round-warn">⚠️ {formatTimeLeft()} to collect</div>
                  )}
                </div>

                <div className="fp-round-right">
                  {canClaim ? (
                    <>
                      <button onClick={() => onClaim(r.epoch)} className="fp-round-claim-btn">💰 Collect</button>
                      {hoursLeft >= 2 && (<div className="fp-round-claim-sub">{formatTimeLeft()}</div>)}
                    </>
                  ) : expired && hasUnclaimedWin ? (
                    <div className="fp-round-status expired">⌛ EXPIRED</div>
                  ) : (
                    <div className={'fp-round-status ' + statusKey}>{statusLabel}</div>
                  )}
                </div>
              </div>
            );
          })}

          {rounds.length > 0 && (
            <div className="fp-sheet-note">
              ⚠️ Uncollected winnings are forfeited after <b>{forfeitLabel}</b>. Collect promptly.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// BET MODAL
// ============================================================
function BetModal({ open, side, epoch, onClose, onTrade, balance, headsPayout, tailsPayout, minBet, maxBet }) {
  const [amount, setAmount] = useState('5');
  const [status, setStatus] = useState('idle');
  const [errMsg, setErrMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAmount(String(Math.min(Math.max(5, minBet), maxBet))); setStatus('idle'); setErrMsg('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const amt = parseFloat(amount) || 0;
  const payout = side === 'heads' ? headsPayout : tailsPayout;
  const estWin = amt * payout;
  const isLong = side === 'heads';
  const sideKey = isLong ? 'long' : 'short';
  const sideLabel = isLong ? '↑ UP' : '↓ DOWN';
  const insufficient = amt > balance;
  const belowMin = amt > 0 && amt < minBet;
  const aboveMax = amt > maxBet;
  const invalidAmount = belowMin || aboveMax || insufficient;

  // Quick-bet chips clamped to the live min/max so a preset can never be invalid.
  const chipPresets = [1, 5, 10, 25, 50, 100];
  const chipsInRange = chipPresets.filter(v => v >= minBet && v <= maxBet);
  const betChips = (chipsInRange.length ? chipsInRange : [minBet, maxBet]).slice(0, 4);

  const handleTrade = async () => {
    if (amt <= 0 || invalidAmount) return;
    setStatus('signing'); setErrMsg('');
    try {
      await onTrade(epoch, side, amt);
      setStatus('success');
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setErrMsg(e.message || 'Transaction failed');
      setStatus('error');
    }
  };

  let buttonLabel = 'Trade';
  if (insufficient) buttonLabel = 'Insufficient Balance';
  else if (belowMin) buttonLabel = `Minimum $${minBet}`;
  else if (aboveMax) buttonLabel = `Maximum $${maxBet}`;
  else if (status === 'signing') buttonLabel = 'Signing…';
  else buttonLabel = isLong ? `Long #${epoch} · $${amt.toFixed(2)}` : `Short #${epoch} · $${amt.toFixed(2)}`;

  return (
    <>
      <div onClick={onClose} className="fp-sheet-backdrop" style={{ zIndex: 300 }}/>
      <div className="fp-bet-sheet">
        <div className="fp-grabber"/>
        <div className="fp-bet-head">
          <div className="fp-bet-head-left">
            <div className={'fp-bet-side-pill ' + sideKey}>{sideLabel}</div>
            <span className="fp-bet-epoch">Round #{epoch}</span>
          </div>
          <button onClick={onClose} className="fp-close-btn">✕</button>
        </div>

        <div className={'fp-bet-amount ' + sideKey + (status === 'error' ? ' err' : '')}>
          <div className="fp-bet-amount-label">
            AMOUNT (USD) · MIN ${minBet} · MAX ${maxBet}
          </div>
          <div className="fp-bet-amount-row">
            <span className="fp-bet-dollar">$</span>
            <input
              ref={inputRef}
              type="number"
              min={minBet}
              max={maxBet}
              value={amount}
              onChange={e => { setAmount(e.target.value); setStatus('idle'); setErrMsg(''); }}
              disabled={status === 'signing' || status === 'success'}
              className="fp-bet-input"
            />
            {balance != null && <span className="fp-bet-bal">Bal: ${balance.toFixed(2)}</span>}
          </div>
        </div>

        <div className="fp-bet-chips">
          {betChips.map(v => {
            const active = parseFloat(amount) === v;
            return (
              <button
                key={v}
                onClick={() => { setAmount(String(v)); setStatus('idle'); setErrMsg(''); }}
                disabled={status === 'signing' || status === 'success'}
                className={'fp-bet-chip' + (active ? ' active ' + sideKey : '')}
              >${v}</button>
            );
          })}
        </div>

        {amt > 0 && !belowMin && !aboveMax && (
          <div className="fp-bet-est">
            <div className="fp-bet-est-block">
              <div className="fp-bet-est-l">EST. PAYOUT</div>
              <div className={'fp-bet-est-v ' + sideKey}>${estWin.toFixed(2)}</div>
            </div>
            <div className="fp-bet-est-r">
              <div className="fp-bet-est-l">MULTIPLIER</div>
              <div className="fp-bet-est-v gold">{payout.toFixed(2)}×</div>
            </div>
          </div>
        )}

        {status === 'signing' && (
          <div className={'fp-bet-status ' + sideKey}>
            <div className="fp-bet-spinner"/>
            Check your wallet…
          </div>
        )}
        {status === 'success' && (
          <div className="fp-bet-success">✓ Trade placed!</div>
        )}
        {status === 'error' && errMsg && (
          <div className="fp-bet-error">{errMsg}</div>
        )}

        {status !== 'success' && (
          <button
            onClick={handleTrade}
            disabled={amt <= 0 || invalidAmount || status === 'signing'}
            className={'fp-bet-cta ' + sideKey}
          >
            {buttonLabel}
          </button>
        )}
        <div className="fp-bet-foot">NETWORK FEE ~0.000005 SOL · 25% FEE ON WINNINGS ONLY</div>
      </div>
    </>
  );
}

// ============================================================
// ROUND CARD
// ============================================================
function LiveHero({ round, livePrice, bets, onSide }) {
  const { epoch, headsPool = 0, tailsPool = 0, lockPrice = 0, closeTime = 0 } = round;
  const total = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? 1 + ((total / headsPool) - 1) * NET_MULT : 2.0;
  const tailsPayout = tailsPool > 0 ? 1 + ((total / tailsPool) - 1) * NET_MULT : 2.0;

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  // rolling live-price buffer for the sparkline (resets per round)
  const [hist, setHist] = useState([]);
  useEffect(() => { setHist([]); }, [epoch]);
  useEffect(() => {
    if (livePrice > 0) setHist(h => (h.length && h[h.length - 1] === livePrice ? h : [...h.slice(-39), livePrice]));
  }, [livePrice]);

  const timeLeft = Math.max(0, closeTime - now);
  const urgent = timeLeft <= 10 && timeLeft > 0;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const priceDiff = lockPrice > 0 ? livePrice - lockPrice : 0;
  const up = priceDiff >= 0;
  const upPct = total > 0 ? Math.round((headsPool / total) * 100) : 50;

  const betsArr = Array.isArray(bets) ? bets : (bets ? [bets] : []);
  const myUp = betsArr.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
  const myDown = betsArr.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);
  const myBet = myUp + myDown;
  const mySide = myUp >= myDown ? 'heads' : 'tails';
  const myPayout = mySide === 'heads' ? headsPayout : tailsPayout;

  let spark = null;
  if (hist.length >= 2) {
    const min = Math.min(...hist), max = Math.max(...hist), rng = (max - min) || 1;
    const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * 300).toFixed(1)},${(50 - ((v - min) / rng) * 44).toFixed(1)}`).join(' ');
    spark = (
      <svg className="fx-spk" viewBox="0 0 300 54" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <div className="fx-lcard">
      <div className="fx-lhead">
        <span className="fx-lv"><span className="fx-dot" />LIVE<span className="fx-ep">#{epoch}</span></span>
        <span className={'fx-tm' + (urgent ? ' urgent' : '')}>{fmt(timeLeft)}</span>
      </div>

      <button className="fx-big up" onClick={() => onSide(epoch, 'heads', headsPayout, tailsPayout)}>
        <span className="fx-ic">↑</span><span className="fx-lb">UP</span><span className="fx-ml">{headsPayout.toFixed(2)}×</span>
      </button>

      <div className="fx-panel">
        <div className="fx-plab">
          <span className="fx-l">LIVE PRICE</span>
          <span className="fx-co">locked {lockPrice > 0 ? '$' + lockPrice.toFixed(2) : '—'}</span>
        </div>
        <div className="fx-prow2">
          <div className="fx-cprice" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>${livePrice.toFixed(4)}</div>
          {lockPrice > 0 && (
            <div className="fx-cdelta" style={{ background: up ? 'var(--up)' : 'var(--down)' }}>
              {up ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}
            </div>
          )}
        </div>
        {spark}
        <div className="fx-metrow">
          <div className="fx-met"><div className="fx-ml2">PRIZE POOL</div><div className="fx-mv g">${total.toFixed(2)}</div></div>
          {myBet > 0
            ? <div className="fx-met"><div className="fx-ml2">YOUR BET</div><div className="fx-mv">${myBet.toFixed(2)} → ~${(myBet * myPayout).toFixed(2)}</div></div>
            : <div className="fx-met"><div className="fx-ml2">DOWN PAYS</div><div className="fx-mv">{tailsPayout.toFixed(2)}×</div></div>}
        </div>
        <div className="fx-sent">
          <div className="fx-sl"><span className="su">▲ UP {upPct}%</span><span className="sd">{100 - upPct}% DOWN ▼</span></div>
          <div className="fx-bar"><div className="fx-f" style={{ width: upPct + '%' }} /></div>
        </div>
        {myBet > 0 && (
          <div className="fx-pos">
            <span>● YOUR {mySide === 'heads' ? 'UP' : 'DOWN'} BET</span>
            <span>${myBet.toFixed(2)} → ~${(myBet * myPayout).toFixed(2)}</span>
          </div>
        )}
      </div>

      <button className="fx-big down" onClick={() => onSide(epoch, 'tails', headsPayout, tailsPayout)}>
        <span className="fx-ic">↓</span><span className="fx-lb">DOWN</span><span className="fx-ml">{tailsPayout.toFixed(2)}×</span>
      </button>
    </div>
  );
}

function UpcomingTile({ round, next, onSide }) {
  const { epoch, headsPool = 0, tailsPool = 0, lockTime = 0 } = round;
  const total = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? 1 + ((total / headsPool) - 1) * NET_MULT : 2.0;
  const tailsPayout = tailsPool > 0 ? 1 + ((total / tailsPool) - 1) * NET_MULT : 2.0;

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);
  const startsIn = Math.max(0, lockTime - now);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="fx-ut">
      <div className="fx-uh">
        <span className="fx-ue">#{epoch}</span>
        {next ? <span className="fx-ub">NEXT</span> : <span className="fx-us2">⏱ {fmt(startsIn)}</span>}
      </div>
      {next && (
        <div className="fx-us">in <b>{fmt(startsIn)}</b>{total > 0 ? <> · <span className="g">${total.toFixed(0)}</span></> : null}</div>
      )}
      <div className="fx-ubt">
        <button className="fx-mini u" onClick={() => onSide(epoch, 'heads', headsPayout, tailsPayout)}>↑ UP</button>
        <button className="fx-mini d" onClick={() => onSide(epoch, 'tails', headsPayout, tailsPayout)}>↓ DOWN</button>
      </div>
    </div>
  );
}

// ============================================================
// MAIN
// ============================================================
export default function Flipsy({ onConnectWallet }) {
  const wallet = useWallet();

  useEffect(() => { injectFlipsyStyles(); }, []);

  let hookData = null, hookError = null;
  try { hookData = useFlipsy(wallet); }
  catch (e) { hookError = e; console.error('[Flipsy] useFlipsy threw:', e); }

  const {
    livePrice = 0, liveRound = null, upcomingRounds = [], recentRounds = [], userBets = {}, balance = 0,
    balanceStatus = 'idle',
    placeBet = async () => { throw new Error('Hook not ready'); },
    claim = async () => { throw new Error('Hook not ready'); },
    loading = true,
    programConfig = null,
    chainError = null,
  } = hookData || {};

  const minBetUsd = programConfig && livePrice > 0
    ? +((programConfig.minBet / 1e9) * livePrice).toFixed(2)
    : DEFAULT_MIN_BET;
  const maxBetUsd = programConfig && livePrice > 0
    ? +((programConfig.maxBet / 1e9) * livePrice).toFixed(2)
    : DEFAULT_MAX_BET;
  const claimForfeitDelay = programConfig?.claimForfeitDelay || DEFAULT_CLAIM_FORFEIT_DELAY;

  const [flash, setFlash] = useState(null);
  const [geo, setGeo] = useState({ blocked: false, ready: false });
  const [betModal, setBetModal] = useState(null);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const carouselRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    checkGeo().then((res) => { if (!cancelled) setGeo({ blocked: res.blocked, ready: true }); });
    return () => { cancelled = true; };
  }, []);

  const walletBypass = wallet?.publicKey && GEO_BYPASS_WALLETS.has(wallet.publicKey.toBase58());
  const effectivelyBlocked = geo.blocked && !walletBypass;

  useEffect(() => {
    if (hookError) setFlash({ type: 'error', msg: `Hook crashed: ${hookError.message || 'see console'}` });
  }, [hookError]);

  useEffect(() => {
    if (chainError) setFlash({ type: 'error', msg: chainError });
  }, [chainError]);

  useEffect(() => {
    if (!liveRound || loading) return;
    const t = setTimeout(() => {
      const live = carouselRef.current?.querySelector('.fp-card-live');
      if (live && carouselRef.current) {
        const container = carouselRef.current;
        container.scrollLeft = live.offsetLeft + live.offsetWidth / 2 - container.offsetWidth / 2;
      }
    }, 400);
    return () => clearTimeout(t);
  }, [liveRound?.epoch, loading]);

  useEffect(() => {
    if (flash) { const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }
  }, [flash]);

  const getBetsForEpoch = (epoch) => {
    const b = userBets[epoch];
    if (!b) return [];
    return Array.isArray(b) ? b : [b];
  };

  const nowTs = Math.floor(Date.now() / 1000);

  const isClaimable = (round) => {
    const expired = round.resolvedAt > 0 && nowTs > round.resolvedAt + claimForfeitDelay;
    if (expired) return false;
    const bets = getBetsForEpoch(round.epoch);
    return bets.some(b => {
      if (b.claimed) return false;
      if (round.outcome === b.side) return true;
      if (round.outcome === 'tie') return true;
      return false;
    });
  };

  const claimableRounds = recentRounds.filter(r => isClaimable(r));
  const hasClaim = claimableRounds.length > 0;

  const handleSideTap = (epoch, side, headsPayout, tailsPayout) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    setBetModal({ epoch, side, headsPayout, tailsPayout });
  };

  const handleTrade = useCallback(async (epoch, side, amount) => {
    if (amount < minBetUsd) throw new Error(`Minimum bet is $${minBetUsd}`);
    if (amount > maxBetUsd) throw new Error(`Maximum bet is $${maxBetUsd}`);
    if (balance < amount) throw new Error('Insufficient balance');
    await placeBet(epoch, side, amount);
    setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ UP' : '↓ DOWN'} #${epoch} · $${amount.toFixed(2)}` });
  }, [placeBet, balance, minBetUsd, maxBetUsd]);

  const handleClaim = async (epoch) => {
    if (!wallet.connected) { onConnectWallet?.(); return; }
    try {
      await claim(epoch);
      setFlash({ type: 'success', msg: `💰 Claimed #${epoch}` });
      setRoundsOpen(false);
    } catch (e) {
      setFlash({ type: 'error', msg: e.message || 'Claim failed' });
    }
  };

  if (geo.ready && effectivelyBlocked) {
    return <BlockScreen title={<>Not available <em>here</em></>} message="Flipsy is not available in your region." sub="This may change in the future." />;
  }

  const liveEpoch = liveRound?.epoch ?? upcomingRounds[0]?.epoch ?? null;
  const nothingToShow = !liveRound && upcomingRounds.length === 0 && recentRounds.length === 0;

  // --- derived UI data ---
  const sortedRecent = [...recentRounds].sort((a, b) => (b.epoch || 0) - (a.epoch || 0)); // newest first
  let streak = 0;
  for (const r of sortedRecent) {
    if (!r || r.outcome === 'unresolved') continue;
    const rb = getBetsForEpoch(r.epoch);
    if (!rb || rb.length === 0) break;            // streak counts only rounds you played
    const won = rb.some(b => r.outcome === b.side || r.outcome === 'tie');
    if (won) streak++; else break;
  }

  const resolved = [...recentRounds]
    .filter(r => r && r.outcome && r.outcome !== 'unresolved')
    .sort((a, b) => (a.epoch || 0) - (b.epoch || 0));
  const pips = resolved.slice(-12).map(r => (r.outcome === 'heads' ? 'u' : r.outcome === 'tails' ? 'd' : 't'));
  const upCount = pips.filter(p => p === 'u').length;
  const upRate = pips.length ? Math.round((upCount / pips.length) * 100) : 0;

  const heroRound = liveRound || upcomingRounds[0] || null;
  const gridRounds = liveRound ? upcomingRounds.slice(0, 6) : upcomingRounds.slice(1, 7);

  // Honest balance pill — never a silent zero.
  const renderBalance = () => {
    if (!wallet.connected) {
      return (
        <div className="fx-bal fx-bal-connect" onClick={() => onConnectWallet?.()}>
          <span className="fx-bal-v">Connect</span>
        </div>
      );
    }
    const isLoading = balanceStatus === 'loading' || balanceStatus === 'idle';
    const isFail = balanceStatus === 'fail';
    return (
      <div className={'fx-bal' + (isFail ? ' warn' : '')} title={isFail ? 'Solana RPC declined the balance lookup' : undefined}>
        <span className="fx-bal-l">BAL</span>
        <span className={'fx-bal-v' + (isFail ? ' fail' : '')}>
          {isFail ? 'RPC DOWN' : isLoading ? '…' : '$' + balance.toFixed(2)}
        </span>
      </div>
    );
  };

  return (
    <div className="fp-page fx-page">
      {hasClaim && (
        <div className="fx-claim" onClick={() => setRoundsOpen(true)}>
          <span>◆</span>
          <span>{claimableRounds.length} ROUND{claimableRounds.length > 1 ? 'S' : ''} READY TO COLLECT</span>
          <b className="fx-claim-c">{claimableRounds.length}</b>
        </div>
      )}

      {flash && (
        <div className="fx-flash-wrap"><div className={'fx-flash ' + flash.type}>{flash.msg}</div></div>
      )}

      <div className="fx-inner">
        <header className="fx-hd">
          <div className="fx-br">
            <div className="fx-mascot">F</div>
            <div>
              <div className="fx-bt">flipsy</div>
              <div className="fx-bs">Solana Sentiment</div>
            </div>
          </div>
          <div className="fx-hr">
            {streak > 0 && <div className="fx-streak">🔥 {streak}</div>}
            {renderBalance()}
          </div>
        </header>

        <div className="fx-prow">
          <div className="fx-ppill">
            <div className="fx-ptok">◎</div>
            <div>
              <div className="fx-pv">{livePrice > 0 ? '$' + livePrice.toFixed(2) : '—'}</div>
              <div className="fx-pl">SOL / USD</div>
            </div>
          </div>
        </div>

        {SOL_FORECASTS.length > 0 && (
          <>
            <div className="fx-fclbl">◎ SOL FORECAST · ANALYST ESTIMATES</div>
            <div className="fx-fcrow">
              {SOL_FORECASTS.map((f, i) => (
                <div className="fx-fcell" key={i}>
                  <div className="fx-ft">{f.t}</div>
                  <div className="fx-fp">{f.p}</div>
                  <div className={'fx-fd ' + (f.k || 'n')}>{f.k === 'u' ? '↑ ' : ''}{f.d}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {pips.length > 0 && (
          <div className="fx-hist">
            <span className="fx-hl">LAST {pips.length}</span>
            <span className="fx-pips">{pips.map((p, i) => <span key={i} className={'fx-pip ' + p} />)}</span>
            <span className="fx-wr">{upRate}% ↑</span>
          </div>
        )}

        <div className="fx-rh">
          <h3>{heroRound ? <>Live Round <em>#{heroRound.epoch}</em></> : <>Rounds</>}</h3>
          <span className="fx-sw">↑ up or ↓ down?</span>
        </div>

        <div className="fx-wrap">
          {loading && nothingToShow && <div className="fx-empty">Loading rounds…</div>}
          {!loading && nothingToShow && chainError && (
            <div className="fx-empty err"><div className="fx-empty-i">⚠️</div><div className="fx-empty-t">Couldn't load rounds</div><div className="fx-empty-m">{chainError}</div></div>
          )}
          {!loading && nothingToShow && !chainError && (
            <div className="fx-empty"><div className="fx-empty-i">⏳</div><div className="fx-empty-t">No active rounds</div><div className="fx-empty-m">New rounds start automatically. Hang tight.</div></div>
          )}
          {heroRound && (
            <LiveHero round={heroRound} livePrice={livePrice} bets={getBetsForEpoch(heroRound.epoch)} onSide={handleSideTap} />
          )}
        </div>

        {gridRounds.length > 0 && (
          <>
            <div className="fx-utitle"><h4>Upcoming rounds</h4><span className="fx-c">bet early →</span></div>
            <div className="fx-ugrid">
              {gridRounds.map((r, i) => (
                <UpcomingTile key={r.epoch} round={r} next={!!liveRound && i === 0} onSide={handleSideTap} />
              ))}
            </div>
          </>
        )}

        <div className="fx-tabs">
          <div className="fx-tab on">◆ Play</div>
          <div className="fx-tab disabled">🏆 Leaders<span className="fx-soon">soon</span></div>
          <div className="fx-tab" onClick={() => setRoundsOpen(true)}>
            📋 My Rounds{hasClaim ? ` · ${claimableRounds.length}` : ''}
          </div>
        </div>

        <div className="fx-footer">Powered by Solana · Non-custodial · 25% fee on wins only · No other fees</div>
      </div>

      <RoundsPopup
        open={roundsOpen}
        onClose={() => setRoundsOpen(false)}
        liveRound={liveRound}
        upcomingRounds={upcomingRounds}
        recentRounds={recentRounds}
        userBets={userBets}
        onClaim={handleClaim}
        claimForfeitDelay={claimForfeitDelay}
      />

      {betModal && (
        <BetModal
          open={!!betModal} side={betModal.side} epoch={betModal.epoch}
          headsPayout={betModal.headsPayout} tailsPayout={betModal.tailsPayout}
          balance={balance} livePrice={livePrice}
          minBet={minBetUsd} maxBet={maxBetUsd}
          onClose={() => setBetModal(null)} onTrade={handleTrade}
        />
      )}
    </div>
  );
}
