import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFlipsy } from '../hooks/useFlipsy';
   
// ============================================================
// INLINE CSS — Wonderland with Solana-tinted accents · injected once
// ============================================================
const FLIPSY_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');

.fp-page{
  --ink:#1A1B4E; --ink-2:rgba(26,27,78,0.7); --ink-3:rgba(26,27,78,0.45);
  --pink:#FF8FBE; --mint:#7FFFD4; --lav:#B794F6; --peach:#FFB088;
  --sky:#A0E7FF; --gold:#FFD46B;
  --sol-mint:#14F195; --sol-mag:#DC1FFF; --sol-cyan:#00D9FF; --sol-purple:#9945FF;
  --green:#0a7a4c; --red:#D14B6A;
  --glass:rgba(255,255,255,0.6); --glass-strong:rgba(255,255,255,0.80);
  --border:rgba(183,148,246,0.22);
  --hairline:rgba(26,27,78,0.08);

  position:relative;min-height:100vh;min-height:100dvh;width:100%;
  padding-bottom:calc(env(safe-area-inset-bottom) + 60px);overflow-x:hidden;
  color:var(--ink);
  font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;
  background:
    radial-gradient(ellipse at 20% 0%,#FFE8F4 0%,transparent 45%),
    radial-gradient(ellipse at 90% 5%,#FFF3D9 0%,transparent 40%),
    radial-gradient(ellipse at 70% 45%,#E4F2FF 0%,transparent 55%),
    radial-gradient(ellipse at 10% 80%,#F0E7FF 0%,transparent 50%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  background-attachment:fixed;
  border-radius:24px;
}
.fp-page *{box-sizing:border-box}

@keyframes fp-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.05)}}
@keyframes fp-pulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes fp-spin{to{transform:rotate(360deg)}}
@keyframes fp-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes fp-mascot-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-3px) rotate(3deg)}}
@keyframes fp-card-enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fp-live-glow{0%,100%{opacity:0.45}50%{opacity:0.7}}
@keyframes fp-price-tick{from{transform:translateY(2px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fp-pop{0%{transform:scale(0.92);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
@keyframes fp-banner-slide{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fp-modal-up{from{transform:translateX(-50%) translateY(100%);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
@keyframes fp-timer-urgent{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}

.fp-blob{
  position:absolute;border-radius:50%;filter:blur(70px);opacity:0.42;
  animation:fp-drift 14s ease-in-out infinite;pointer-events:none;z-index:0;
}

/* CLAIM BANNER */
.fp-claim-banner{
  position:sticky;top:0;z-index:50;
  padding:11px 16px;
  display:flex;align-items:center;justify-content:center;gap:8px;
  background:linear-gradient(90deg,#FFD46B,#FFB088 50%,#FF8FBE);
  color:var(--ink);
  font-family:"Space Grotesk",sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;
  cursor:pointer;
  box-shadow:0 4px 18px rgba(255,180,140,.35);
  animation:fp-banner-slide .4s cubic-bezier(.16,1,.3,1);
}
.fp-claim-banner:active{opacity:.92}
.fp-claim-banner-count{
  background:rgba(26,27,78,0.12);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:800;
}

/* TOP FLASH */
.fp-flash-top{margin:8px 22px 0;position:relative;z-index:10}
.fp-flash{
  padding:10px 14px;border-radius:14px;
  font-size:11px;font-weight:700;text-align:center;letter-spacing:0.4px;
  font-family:"Space Grotesk",sans-serif;
  animation:fp-pop .35s cubic-bezier(.34,1.56,.64,1);
}
.fp-flash.error{background:rgba(209,75,106,.10);color:var(--red);border:1px solid rgba(209,75,106,.35)}
.fp-flash.success{background:rgba(20,241,149,.16);color:var(--green);border:1px solid rgba(20,241,149,.45)}

/* HEADER */
.fp-page-inner{position:relative;z-index:5}

.fp-header{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:18px 22px 6px;max-width:520px;margin:0 auto;
}
.fp-brand{display:flex;align-items:center;gap:12px}
.fp-mascot{
  width:46px;height:46px;border-radius:50%;
  background:linear-gradient(135deg,#FF8FBE 0%,#FFD46B 30%,#7FFFD4 60%,#B794F6 100%);
  display:grid;place-items:center;
  font-family:"Instrument Serif",serif;font-style:italic;font-size:24px;color:#fff;
  text-shadow:0 2px 4px rgba(26,27,78,.20);
  box-shadow:0 6px 22px rgba(183,148,246,0.40),
             inset 0 -2px 4px rgba(26,27,78,.10),
             inset 0 2px 4px rgba(255,255,255,.40);
  animation:fp-mascot-float 4s ease-in-out infinite;
  flex-shrink:0;
}
.fp-brand-text .fp-title{
  font-family:"Instrument Serif",serif;font-style:italic;font-size:26px;line-height:1;letter-spacing:-.02em;
  background:linear-gradient(90deg,#FF8FBE,#FFD46B 30%,#7FFFD4 60%,#B794F6);
  background-size:200% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:fp-shimmer 8s linear infinite;
}
.fp-brand-text .fp-subtitle{
  margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.6px;text-transform:uppercase;
}

.fp-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.fp-rounds-btn{
  display:flex;align-items:center;gap:6px;
  padding:7px 13px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);color:var(--ink);
  font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.8px;
  cursor:pointer;transition:all .15s;
}
.fp-rounds-btn:hover{border-color:var(--lav);background:var(--glass-strong)}
.fp-rounds-btn.fp-has-claim{
  background:linear-gradient(135deg,#FFD46B,#FFB088);
  border-color:rgba(255,180,107,0.45);
  box-shadow:0 4px 12px rgba(255,180,107,.30);
}
.fp-rounds-btn-count{
  background:#fff;color:var(--ink);border-radius:50%;
  width:18px;height:18px;display:grid;place-items:center;
  font-size:10px;font-weight:800;
}
.fp-bal{
  display:flex;align-items:center;gap:6px;
  padding:7px 12px;border-radius:999px;
  background:var(--glass);backdrop-filter:blur(10px);
  border:1px solid var(--border);
  cursor:default;
}
.fp-bal-l{font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--ink-3);letter-spacing:1.4px}
.fp-bal-v{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums}
.fp-bal-v.fp-bal-loading{color:rgba(26,27,78,0.45)}
.fp-bal-v.fp-bal-fail{color:var(--red);font-family:"Space Grotesk",sans-serif;font-size:10px;letter-spacing:0.6px;font-weight:800}
.fp-bal.fp-bal-warn{border-color:rgba(209,75,106,.35)}
.fp-bal-connect{cursor:pointer}
.fp-bal-connect .fp-bal-v{color:var(--sol-purple);font-family:"Space Grotesk",sans-serif;font-size:11px;font-weight:800;letter-spacing:0.6px}

/* ROUNDS LABEL */
.fp-rounds-head{
  padding:14px 26px 8px;max-width:520px;margin:0 auto;
  display:flex;align-items:baseline;justify-content:space-between;gap:10px;
}
.fp-rounds-title{
  font-family:"Instrument Serif",serif;font-size:24px;line-height:1;color:var(--ink);letter-spacing:-.015em;
  margin:0;font-weight:400;
}
.fp-rounds-title em{
  font-style:italic;
  background:linear-gradient(120deg,#7FFFD4,#A0E7FF);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.fp-rounds-sub{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;color:var(--ink-3);
  letter-spacing:1.4px;text-transform:uppercase;
}
.fp-rounds-sub .arrow{color:var(--sol-cyan)}

/* CAROUSEL */
.fp-carousel{
  display:flex;gap:14px;
  padding:14px 22px 26px;
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
  background:var(--glass-strong);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.85);border-radius:28px;
  padding:14px;
  display:flex;flex-direction:column;
  box-shadow:0 16px 40px rgba(26,27,78,.10);
  position:relative;overflow:hidden;
  animation:fp-card-enter .45s cubic-bezier(.2,1,.4,1) backwards;
}
.fp-card-previous{opacity:0.72}
.fp-card-later{opacity:0.78}
.fp-card-loading{width:100%;max-width:320px;margin:0 auto;min-height:200px;justify-content:center;align-items:center;text-align:center;color:var(--ink-2);font-size:13px;font-weight:500;padding:24px}
.fp-card-empty{width:100%;max-width:340px;margin:0 auto;min-height:200px;justify-content:center;align-items:center;text-align:center;padding:24px}
.fp-card-empty-icon{font-size:28px;margin-bottom:10px;opacity:.7}
.fp-card-empty-title{font-family:"Instrument Serif",serif;font-style:italic;font-size:20px;color:var(--ink);margin-bottom:6px;line-height:1.2}
.fp-card-empty-msg{font-size:12px;color:var(--ink-2);font-weight:500;line-height:1.5;word-break:break-word}
.fp-card-empty.err{border-color:rgba(209,75,106,.35);background:rgba(209,75,106,.04)}
.fp-card-empty.err .fp-card-empty-msg{color:var(--red);font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:0.3px}

/* LIVE CARD — signature treatment */
.fp-card-live{
  width:min(310px,86vw);min-height:485px;
  background:
    radial-gradient(ellipse at 50% 0%,rgba(127,255,212,.30),transparent 55%),
    linear-gradient(180deg,#fff 0%,#F5FFFC 100%);
  border-color:rgba(20,241,149,.55);
  box-shadow:0 20px 50px rgba(20,241,149,.18),
             0 0 0 1px rgba(20,241,149,.20),
             0 0 60px rgba(127,255,212,.20);
}
.fp-card-livering{
  position:absolute;
  width:340px;height:340px;border-radius:50%;
  background:radial-gradient(circle,rgba(20,241,149,.20),transparent 60%);
  filter:blur(40px);
  top:-60px;left:50%;transform:translateX(-50%);
  pointer-events:none;z-index:0;
  animation:fp-live-glow 4s ease-in-out infinite;
}
.fp-card-live > *:not(.fp-card-livering){position:relative;z-index:1}

/* URGENT — warm wash on live card during last 10s */
.fp-card-urgent{
  background:
    radial-gradient(ellipse at 50% 0%,rgba(255,180,136,.40),transparent 55%),
    linear-gradient(180deg,#FFF7ED 0%,#FFEEDD 100%) !important;
  border-color:rgba(255,180,136,.65) !important;
  box-shadow:0 20px 50px rgba(255,180,136,.30),
             0 0 0 1px rgba(255,180,136,.30),
             0 0 60px rgba(255,180,136,.30) !important;
}
.fp-card-urgent .fp-card-livering{background:radial-gradient(circle,rgba(255,180,136,.32),transparent 60%)}

/* CARD HEAD */
.fp-card-head{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:12px;padding:0 2px;
}
.fp-card-badge{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  padding:4px 10px;border-radius:999px;letter-spacing:1.2px;
}
.fp-card-badge.prev{background:rgba(26,27,78,.06);color:var(--ink-3)}
.fp-card-badge.live{background:rgba(20,241,149,.18);color:var(--green);border:1px solid rgba(20,241,149,.45)}
.fp-card-badge.live .d{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--green);margin-right:4px;animation:fp-pulse 1.4s ease-in-out infinite;vertical-align:middle}
.fp-card-badge.next{background:rgba(183,148,246,.18);color:#5e3aa8;border:1px solid rgba(183,148,246,.40)}
.fp-card-badge.later{background:rgba(26,27,78,.06);color:var(--ink-3)}
.fp-card-urgent .fp-card-badge.live{background:rgba(255,180,136,.30);color:#8a4a1d;border-color:rgba(255,180,136,.60)}
.fp-card-urgent .fp-card-badge.live .d{background:#8a4a1d}
.fp-card-epoch{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);font-weight:700;letter-spacing:0.6px}

/* SIDE BUTTONS */
.fp-card-side{
  width:100%;padding:14px 16px;border-radius:18px;
  border:1.5px solid;font-family:inherit;font-weight:700;
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  cursor:pointer;transition:transform .2s;
}
.fp-card-side:hover:not(:disabled){transform:translateY(-1px)}
.fp-card-side:active:not(:disabled){transform:scale(.98)}
.fp-card-side:disabled{cursor:not-allowed}
.fp-card-side-icon{font-size:20px;line-height:1;font-weight:900;width:24px;text-align:center}
.fp-card-side-label{flex:1;text-align:center;font-family:"Space Grotesk",sans-serif;font-size:14px;font-weight:800;letter-spacing:0.10em}
.fp-card-side-mult{font-family:"Instrument Serif",serif;font-style:italic;font-size:18px;font-variant-numeric:tabular-nums}

.fp-card-long{
  background:linear-gradient(135deg,rgba(20,241,149,.18),rgba(160,231,255,.10));
  border-color:rgba(20,241,149,.50);color:var(--green);
}
.fp-card-long.active{
  background:linear-gradient(135deg,#14F195,#A0E7FF);
  border-color:#14F195;color:var(--ink);
  box-shadow:0 8px 20px rgba(20,241,149,.30);
}
.fp-card-long.won{
  background:linear-gradient(135deg,#14F195,#A0E7FF);
  border-color:#14F195;color:var(--ink);
}
.fp-card-long.lost{
  background:rgba(20,241,149,.04);
  border-color:rgba(20,241,149,.15);color:var(--ink-3);
}

.fp-card-short{
  background:linear-gradient(135deg,rgba(220,31,255,.14),rgba(183,148,246,.08));
  border-color:rgba(220,31,255,.45);color:#8c1494;
}
.fp-card-short.active{
  background:linear-gradient(135deg,#DC1FFF,#B794F6);
  border-color:#DC1FFF;color:#fff;
  box-shadow:0 8px 20px rgba(220,31,255,.30);
}
.fp-card-short.won{
  background:linear-gradient(135deg,#DC1FFF,#B794F6);
  border-color:#DC1FFF;color:#fff;
}
.fp-card-short.lost{
  background:rgba(220,31,255,.04);
  border-color:rgba(220,31,255,.15);color:var(--ink-3);
}

/* MIDDLE PANEL */
.fp-card-mid{
  margin:10px 0;padding:14px;border-radius:20px;text-align:center;
  background:rgba(255,255,255,.55);border:1px solid var(--hairline);
  flex:1;display:flex;flex-direction:column;justify-content:center;
}
.fp-card-live .fp-card-mid{background:rgba(255,255,255,.70);border-color:rgba(20,241,149,.20)}
.fp-card-urgent .fp-card-mid{background:rgba(255,247,237,.75);border-color:rgba(255,180,136,.30)}

.fp-mid-label{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.6px;text-transform:uppercase;margin-bottom:8px;
}

/* THE BIG SERIF LIVE PRICE — signature */
.fp-mid-price{
  font-family:"Instrument Serif",serif;font-style:italic;font-weight:400;
  font-size:54px;line-height:0.95;letter-spacing:-.03em;color:var(--ink);
  font-variant-numeric:tabular-nums;
}

.fp-mid-delta{
  display:inline-block;margin-top:8px;
  padding:3px 12px;border-radius:999px;
  font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:0.6px;
  font-variant-numeric:tabular-nums;
}
.fp-mid-delta.up{background:rgba(20,241,149,.18);color:var(--green);border:1px solid rgba(20,241,149,.40)}
.fp-mid-delta.down{background:rgba(220,31,255,.14);color:#8c1494;border:1px solid rgba(220,31,255,.40)}

.fp-mid-divider{height:1px;margin:12px 0;background:linear-gradient(90deg,transparent,var(--hairline),transparent)}

.fp-mid-row{
  display:flex;justify-content:space-between;
  font-family:"JetBrains Mono",monospace;font-size:11px;
  color:var(--ink-3);margin-top:4px;letter-spacing:0.4px;
}
.fp-mid-row-val{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.fp-mid-row-val.gold{color:#a67200}

.fp-mid-timer{
  margin-top:14px;
  font-family:"Instrument Serif",serif;font-size:32px;line-height:1;color:#a67200;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em;
}
.fp-mid-timer.urgent{
  color:#d14b1d;font-style:italic;
  animation:fp-timer-urgent .5s ease-in-out infinite;
}

.fp-mid-pool{
  font-family:"Instrument Serif",serif;font-size:38px;line-height:1;letter-spacing:-.025em;
  background:linear-gradient(135deg,#14F195,#FFD46B);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  font-variant-numeric:tabular-nums;
}

.fp-mid-payout-preview{
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);
  margin-top:6px;line-height:1.5;
}
.fp-mid-payout-preview b{font-weight:700}
.fp-mid-payout-preview .l{color:var(--green);font-weight:700}
.fp-mid-payout-preview .s{color:#8c1494;font-weight:700}

.fp-mid-starts{
  margin-top:10px;
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-3);letter-spacing:0.4px;
}
.fp-mid-starts b{
  color:var(--ink);font-family:"Instrument Serif",serif;font-style:italic;
  font-size:15px;font-weight:400;font-variant-numeric:tabular-nums;
}

.fp-mid-later-icon{font-size:32px;margin:14px 0 8px;opacity:0.6}

.fp-mid-outcome{
  margin-top:8px;display:inline-block;
  padding:6px 14px;border-radius:999px;
  font-family:"Space Grotesk",sans-serif;font-size:11px;font-weight:800;letter-spacing:1.2px;
}
.fp-mid-outcome.long{background:rgba(20,241,149,.18);color:var(--green);border:1px solid rgba(20,241,149,.45)}
.fp-mid-outcome.short{background:rgba(220,31,255,.14);color:#8c1494;border:1px solid rgba(220,31,255,.45)}
.fp-mid-outcome.tie{background:rgba(183,148,246,.18);color:#5e3aa8;border:1px solid rgba(183,148,246,.45)}

.fp-mid-claim{
  margin-top:10px;width:100%;padding:10px;border-radius:14px;
  background:linear-gradient(135deg,#FFD46B,#FFB088);
  border:none;color:var(--ink);
  font-family:"Space Grotesk",sans-serif;font-weight:800;font-size:12px;letter-spacing:0.8px;
  cursor:pointer;box-shadow:0 6px 16px rgba(255,180,107,.32);
  transition:transform .15s;
}
.fp-mid-claim:hover{transform:translateY(-2px)}

/* USER POSITION */
.fp-card-position{
  margin-top:10px;padding:8px 14px;border-radius:14px;
  display:flex;justify-content:space-between;align-items:center;
  font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:0.6px;
  animation:fp-pop .3s cubic-bezier(.34,1.56,.64,1);
}
.fp-card-position-heads{background:rgba(20,241,149,.16);border:1px solid rgba(20,241,149,.45);color:var(--green)}
.fp-card-position-tails{background:rgba(220,31,255,.14);border:1px solid rgba(220,31,255,.45);color:#8c1494}

/* FOOTER */
.fp-footer{
  max-width:520px;margin:18px auto 0;
  padding:8px 22px;text-align:center;
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);font-weight:600;
  letter-spacing:0.8px;
}

/* BLOCK SCREEN */
.fp-block-wrap{
  min-height:70vh;display:flex;align-items:center;justify-content:center;
  padding:40px 22px;position:relative;z-index:5;
}
.fp-block-card{
  max-width:440px;width:100%;
  background:var(--glass-strong);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.85);border-radius:28px;
  padding:36px 28px;text-align:center;
  box-shadow:0 24px 60px rgba(183,148,246,.18);
}
.fp-block-icon{
  width:56px;height:56px;margin:0 auto 18px;border-radius:18px;
  background:linear-gradient(135deg,#FF8FBE,#B794F6);
  display:grid;place-items:center;color:#fff;font-size:24px;
  box-shadow:0 8px 20px rgba(255,143,190,.35);
}
.fp-block-title{
  margin:0 0 10px;
  font-family:"Instrument Serif",serif;font-size:28px;font-weight:400;color:var(--ink);
  letter-spacing:-.02em;
}
.fp-block-title em{
  font-style:italic;
  background:linear-gradient(90deg,#FF8FBE,#B794F6);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.fp-block-msg{margin:0 0 12px;font-size:13px;color:var(--ink-2);line-height:1.6;font-weight:500}
.fp-block-sub{margin:0;font-size:11px;color:var(--ink-3);font-style:italic}

/* ROUNDS POPUP (sheet) */
.fp-sheet-backdrop{
  position:fixed;inset:0;z-index:200;
  background:rgba(26,27,78,0.40);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
}
.fp-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:201;
  max-height:80dvh;display:flex;flex-direction:column;overflow:hidden;
  background:
    radial-gradient(ellipse at 20% 0%,#FFE8F4 0%,transparent 50%),
    radial-gradient(ellipse at 80% 0%,#E4F2FF 0%,transparent 50%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  border-top:1px solid rgba(255,255,255,.85);
  border-radius:28px 28px 0 0;
  box-shadow:0 -24px 80px rgba(26,27,78,.18);
  font-family:"Space Grotesk",sans-serif;
  animation:fp-modal-up .3s cubic-bezier(.16,1,.3,1);
}
.fp-grabber{width:40px;height:4px;border-radius:99px;background:rgba(26,27,78,.18);margin:10px auto 16px}
.fp-sheet-head{flex-shrink:0;padding:0 22px 14px}
.fp-sheet-head-row{
  display:flex;align-items:center;justify-content:space-between;
}
.fp-sheet-title{
  font-family:"Instrument Serif",serif;font-size:22px;color:var(--ink);letter-spacing:-.015em;line-height:1;
}
.fp-sheet-title em{
  font-style:italic;
  background:linear-gradient(120deg,#FF8FBE,#B794F6);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.fp-close-btn{
  width:34px;height:34px;border-radius:50%;
  background:var(--glass-strong);border:1px solid var(--border);
  color:var(--ink);font-size:16px;cursor:pointer;font-family:inherit;
  display:grid;place-items:center;transition:all .15s;
}
.fp-close-btn:hover{background:#fff;border-color:var(--lav)}

.fp-sheet-body{flex:1;overflow-y:auto;padding:0 22px 14px}
.fp-sheet-empty{
  text-align:center;padding:40px 0;color:var(--ink-3);
  font-size:13px;font-weight:500;
}

.fp-round-row{
  display:flex;align-items:center;gap:12px;
  padding:12px 14px;margin-bottom:8px;border-radius:18px;
  background:var(--glass-strong);border:1px solid;
}
.fp-round-row.claim{border-color:rgba(255,180,107,0.45);background:linear-gradient(135deg,rgba(255,212,107,.18),rgba(255,255,255,.78))}
.fp-round-row.live{border-color:rgba(20,241,149,.40)}
.fp-round-row.pending{border-color:rgba(0,217,255,.30)}
.fp-round-row.won{border-color:rgba(20,241,149,.30)}
.fp-round-row.lost{border-color:rgba(220,31,255,.25)}
.fp-round-row.tie{border-color:rgba(183,148,246,.30)}
.fp-round-row.expired{border-color:var(--hairline)}

.fp-round-epoch{min-width:42px;text-align:center}
.fp-round-epoch .l{font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--ink-3);font-weight:700;letter-spacing:1.2px}
.fp-round-epoch .n{font-family:"Instrument Serif",serif;font-style:italic;font-size:18px;color:var(--lav);line-height:1.1}

.fp-round-mid{flex:1;min-width:0}
.fp-round-prices{
  font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-2);font-variant-numeric:tabular-nums;
}
.fp-round-bets{margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.fp-round-bets .l{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--green);font-weight:700;font-variant-numeric:tabular-nums}
.fp-round-bets .s{font-family:"JetBrains Mono",monospace;font-size:10px;color:#8c1494;font-weight:700;font-variant-numeric:tabular-nums}
.fp-round-warn{
  margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:9px;
  color:#a67200;font-weight:700;
}

.fp-round-right{text-align:right;flex-shrink:0}
.fp-round-status{
  font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;
  padding:5px 10px;border-radius:8px;letter-spacing:0.6px;
  display:inline-block;
}
.fp-round-status.live{background:rgba(20,241,149,.18);color:var(--green);border:1px solid rgba(20,241,149,.40)}
.fp-round-status.pending{background:rgba(0,217,255,.14);color:#006e8a;border:1px solid rgba(0,217,255,.35)}
.fp-round-status.won{background:rgba(20,241,149,.18);color:var(--green);border:1px solid rgba(20,241,149,.40)}
.fp-round-status.lost{background:rgba(220,31,255,.14);color:#8c1494;border:1px solid rgba(220,31,255,.35)}
.fp-round-status.tie{background:rgba(183,148,246,.18);color:#5e3aa8;border:1px solid rgba(183,148,246,.35)}
.fp-round-status.expired{background:rgba(26,27,78,.06);color:var(--ink-3);border:1px solid var(--hairline)}

.fp-round-claim-btn{
  background:linear-gradient(135deg,#FFD46B,#FFB088);border:none;border-radius:10px;
  padding:7px 12px;color:var(--ink);font-family:"Space Grotesk",sans-serif;
  font-weight:800;font-size:11px;letter-spacing:0.6px;cursor:pointer;
  box-shadow:0 4px 12px rgba(255,180,107,.32);
}
.fp-round-claim-sub{
  margin-top:3px;font-family:"JetBrains Mono",monospace;font-size:9px;color:var(--ink-3);
}

.fp-sheet-note{
  margin-top:8px;padding:10px 14px;border-radius:14px;
  background:rgba(255,212,107,.10);border:1px solid rgba(255,212,107,.30);
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-2);
  line-height:1.5;text-align:center;
}
.fp-sheet-note b{color:#a67200;font-weight:800}

/* BET MODAL (sheet) */
.fp-bet-sheet{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);
  width:100%;max-width:520px;z-index:301;
  display:flex;flex-direction:column;overflow:hidden;
  background:
    radial-gradient(ellipse at 20% 0%,#FFE8F4 0%,transparent 50%),
    radial-gradient(ellipse at 80% 0%,#E4F2FF 0%,transparent 50%),
    linear-gradient(180deg,#FBF5FF 0%,#F2F8FF 100%);
  border-top:1px solid rgba(255,255,255,.85);
  border-radius:28px 28px 0 0;
  padding:0 22px calc(env(safe-area-inset-bottom) + 22px);
  font-family:"Space Grotesk",sans-serif;
  animation:fp-modal-up .3s cubic-bezier(.16,1,.3,1);
}

.fp-bet-head{
  display:flex;align-items:center;justify-content:space-between;
  padding-top:0;margin-bottom:16px;
}
.fp-bet-head-left{display:flex;align-items:center;gap:10px;min-width:0}
.fp-bet-side-pill{
  padding:6px 14px;border-radius:999px;
  font-family:"Space Grotesk",sans-serif;font-weight:800;font-size:13px;letter-spacing:1px;
  border:1px solid;
}
.fp-bet-side-pill.long{background:rgba(20,241,149,.18);color:var(--green);border-color:rgba(20,241,149,.50)}
.fp-bet-side-pill.short{background:rgba(220,31,255,.14);color:#8c1494;border-color:rgba(220,31,255,.50)}
.fp-bet-epoch{color:var(--ink-3);font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:0.6px}

.fp-bet-amount{
  background:var(--glass-strong);border:1.5px solid rgba(255,255,255,.85);
  border-radius:18px;padding:14px 18px;margin-bottom:12px;transition:border-color .15s;
}
.fp-bet-amount.long{border-color:rgba(20,241,149,.30)}
.fp-bet-amount.short{border-color:rgba(220,31,255,.30)}
.fp-bet-amount.err{border-color:rgba(209,75,106,.45)}
.fp-bet-amount-label{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.6px;text-transform:uppercase;margin-bottom:6px;
}
.fp-bet-amount-row{display:flex;align-items:center;gap:8px}
.fp-bet-dollar{
  font-family:"Instrument Serif",serif;font-size:30px;color:var(--ink-3);line-height:1;
}
.fp-bet-input{
  flex:1;background:transparent;border:none;outline:none;
  font-family:"Instrument Serif",serif;font-size:38px;line-height:1;color:var(--ink);
  font-variant-numeric:tabular-nums;min-width:0;width:100%;
}
.fp-bet-input:disabled{opacity:.6}
.fp-bet-bal{
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);font-weight:600;
  white-space:nowrap;
}

.fp-bet-chips{display:flex;gap:8px;margin-bottom:14px}
.fp-bet-chip{
  flex:1;padding:9px 0;border-radius:999px;
  background:var(--glass);border:1px solid var(--border);color:var(--ink-2);
  font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;
  transition:all .15s;
}
.fp-bet-chip:hover{background:#fff;border-color:var(--lav)}
.fp-bet-chip.active.long{background:rgba(20,241,149,.18);border-color:rgba(20,241,149,.55);color:var(--green)}
.fp-bet-chip.active.short{background:rgba(220,31,255,.14);border-color:rgba(220,31,255,.55);color:#8c1494}
.fp-bet-chip:disabled{cursor:not-allowed;opacity:.5}

.fp-bet-est{
  background:var(--glass-strong);border:1px solid var(--border);
  border-radius:16px;padding:12px 16px;margin-bottom:14px;
  display:flex;justify-content:space-between;align-items:center;gap:10px;
}
.fp-bet-est-block{}
.fp-bet-est-l{
  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:700;
  color:var(--ink-3);letter-spacing:1.4px;margin-bottom:2px;
}
.fp-bet-est-v{
  font-family:"Instrument Serif",serif;font-size:24px;line-height:1;font-variant-numeric:tabular-nums;
}
.fp-bet-est-v.long{color:var(--green)}
.fp-bet-est-v.short{color:#8c1494}
.fp-bet-est-v.gold{color:#a67200}
.fp-bet-est-r{text-align:right}

.fp-bet-status{
  display:flex;align-items:center;justify-content:center;gap:10px;
  padding:10px;margin-bottom:10px;
  font-size:13px;font-weight:700;
}
.fp-bet-status.long{color:var(--green)}
.fp-bet-status.short{color:#8c1494}
.fp-bet-spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid currentColor;border-top-color:transparent;
  animation:fp-spin .7s linear infinite;
}

.fp-bet-success{
  text-align:center;padding:12px;margin-bottom:10px;
  color:var(--green);font-size:14px;font-weight:800;
  animation:fp-pop .3s cubic-bezier(.34,1.56,.64,1);
}
.fp-bet-error{
  padding:10px 14px;margin-bottom:10px;border-radius:14px;
  background:rgba(209,75,106,.10);border:1px solid rgba(209,75,106,.35);
  color:var(--red);font-size:12px;font-weight:700;
}

.fp-bet-cta{
  width:100%;padding:16px;border-radius:18px;border:none;
  font-family:"Instrument Serif",serif;font-size:18px;letter-spacing:-.01em;
  color:#fff;cursor:pointer;font-weight:400;
  transition:transform .15s;
  position:relative;overflow:hidden;
}
.fp-bet-cta.long{background:linear-gradient(135deg,#14F195,#A0E7FF);color:var(--ink);box-shadow:0 8px 24px rgba(20,241,149,.30)}
.fp-bet-cta.short{background:linear-gradient(135deg,#DC1FFF,#B794F6);color:#fff;box-shadow:0 8px 24px rgba(220,31,255,.30)}
.fp-bet-cta:hover:not(:disabled){transform:translateY(-1px)}
.fp-bet-cta:disabled{background:rgba(26,27,78,.06);color:var(--ink-3);box-shadow:none;cursor:not-allowed}

.fp-bet-foot{
  margin-top:10px;text-align:center;
  font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);font-weight:600;
  letter-spacing:0.6px;
}
`;

function injectFlipsyStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('flipsy-inline-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'flipsy-inline-styles';
  tag.textContent = FLIPSY_CSS;
  document.head.appendChild(tag);
}

const BLOCKED_COUNTRIES = ['US'];
const GEO_BYPASS_WALLETS = new Set([
  'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV',
  'GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA',
]);
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 25;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600; // 6 hours
const NET_MULT = 0.75;

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
  return { country: 'UNKNOWN', blocked: false };
}

function BlockScreen({ title, message, sub }) {
  return (
    <div className="fp-page">
      <div className="fp-blob" style={{ width: 320, height: 320, background: '#FF8FBE', top: '5%', left: '-80px' }}/>
      <div className="fp-blob" style={{ width: 360, height: 360, background: '#A0E7FF', bottom: '10%', right: '-100px', animationDelay: '3s' }}/>
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
      setAmount('5'); setStatus('idle'); setErrMsg('');
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
  const sideLabel = isLong ? '↑ LONG' : '↓ SHORT';
  const insufficient = amt > balance;
  const belowMin = amt > 0 && amt < minBet;
  const aboveMax = amt > maxBet;
  const invalidAmount = belowMin || aboveMax || insufficient;

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
          {[1, 5, 10, 25].map(v => {
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
function RoundCard({ round, state, userBets, livePrice, onSideTap, claim, claimable }) {
  const { epoch, headsPool = 0, tailsPool = 0, lockPrice = 0, closePrice = 0, lockTime = 0, closeTime = 0, outcome = 'unresolved' } = round;
  const totalPool = headsPool + tailsPool;
  const headsPayout = headsPool > 0 ? 1 + ((totalPool / headsPool) - 1) * NET_MULT : 2.0;
  const tailsPayout = tailsPool > 0 ? 1 + ((totalPool / tailsPool) - 1) * NET_MULT : 2.0;

  const isPrev = state === 'previous';
  const isLive = state === 'live';
  const isNext = state === 'next';
  const isLater = state === 'later';

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!isLive) return;
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, [isLive]);

  let badge, badgeKey;
  if (isPrev)  { badge = 'CLOSED'; badgeKey = 'prev'; }
  if (isLive)  { badge = 'LIVE';   badgeKey = 'live'; }
  if (isNext)  { badge = 'NEXT';   badgeKey = 'next'; }
  if (isLater) { badge = 'LATER';  badgeKey = 'later'; }

  const priceDiff = isLive && lockPrice != null ? livePrice - lockPrice : 0;
  const isPriceUp = priceDiff >= 0;
  const timeLeft = isLive ? Math.max(0, closeTime - now) : 0;
  const startsIn = isNext || isLater ? Math.max(0, lockTime - now) : 0;
  const urgent = isLive && timeLeft <= 10 && timeLeft > 0;
  const longWon = isPrev && outcome === 'heads';
  const shortWon = isPrev && outcome === 'tails';
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const betsArr = Array.isArray(userBets) ? userBets : (userBets ? [userBets] : []);
  const longTotal = betsArr.filter(b => b.side === 'heads').reduce((s, b) => s + b.amount, 0);
  const shortTotal = betsArr.filter(b => b.side === 'tails').reduce((s, b) => s + b.amount, 0);

  const cardCls = 'fp-card fp-card-' + state + (urgent ? ' fp-card-urgent' : '');

  return (
    <div className={cardCls}>
      {isLive && <div className="fp-card-livering"/>}
      <div className="fp-card-head">
        <span className={'fp-card-badge ' + badgeKey}>
          {isLive && <span className="d"/>}{badge}
        </span>
        <span className="fp-card-epoch">#{epoch}</span>
      </div>

      <button
        className={'fp-card-side fp-card-long ' + (longWon ? 'won' : isPrev ? 'lost' : '') + (longTotal > 0 ? ' active' : '')}
        onClick={() => !isPrev && onSideTap(epoch, 'heads', headsPayout, tailsPayout)}
        disabled={isPrev}
      >
        <span className="fp-card-side-icon">↑</span>
        <span className="fp-card-side-label">LONG</span>
        <span className="fp-card-side-mult">{headsPayout.toFixed(2)}×</span>
      </button>

      <div className="fp-card-mid">
        {isLive && (<>
          <div className="fp-mid-label">LAST PRICE</div>
          <div className="fp-mid-price">${livePrice.toFixed(4)}</div>
          <div className={'fp-mid-delta ' + (isPriceUp ? 'up' : 'down')}>
            {isPriceUp ? '↑' : '↓'} ${Math.abs(priceDiff).toFixed(4)}
          </div>
          <div className="fp-mid-divider"/>
          <div className="fp-mid-row"><span>Locked</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Pool</span><span className="fp-mid-row-val gold">${totalPool.toFixed(2)}</span></div>
          <div className={'fp-mid-timer' + (urgent ? ' urgent' : '')}>{fmtTime(timeLeft)}</div>
        </>)}
        {isNext && (<>
          <div className="fp-mid-label">PRIZE POOL</div>
          <div className="fp-mid-pool">${totalPool.toFixed(2)}</div>
          <div className="fp-mid-divider"/>
          <div className="fp-mid-payout-preview">
            <div><span className="l">Long</span> wins <b>${(5 * headsPayout).toFixed(2)}</b> per $5</div>
            <div><span className="s">Short</span> wins <b>${(5 * tailsPayout).toFixed(2)}</b> per $5</div>
          </div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isLater && (<>
          <div className="fp-mid-label">UPCOMING</div>
          <div className="fp-mid-later-icon">⏳</div>
          <div className="fp-mid-starts">Starts in <b>{fmtTime(startsIn)}</b></div>
        </>)}
        {isPrev && (<>
          <div className="fp-mid-label">CLOSED</div>
          <div className="fp-mid-row"><span>Lock</span><span className="fp-mid-row-val">${lockPrice.toFixed(2)}</span></div>
          <div className="fp-mid-row"><span>Close</span><span className="fp-mid-row-val">${closePrice.toFixed(2)}</span></div>
          <div className="fp-mid-divider"/>
          <div className={'fp-mid-outcome ' + (longWon ? 'long' : shortWon ? 'short' : 'tie')}>
            {longWon ? '↑ LONG WON' : shortWon ? '↓ SHORT WON' : '= TIE'}
          </div>
          {claimable && <button className="fp-mid-claim" onClick={() => claim?.(epoch)}>💰 Claim Winnings</button>}
        </>)}
      </div>

      <button
        className={'fp-card-side fp-card-short ' + (shortWon ? 'won' : isPrev ? 'lost' : '') + (shortTotal > 0 ? ' active' : '')}
        onClick={() => !isPrev && onSideTap(epoch, 'tails', headsPayout, tailsPayout)}
        disabled={isPrev}
      >
        <span className="fp-card-side-mult">{tailsPayout.toFixed(2)}×</span>
        <span className="fp-card-side-label">SHORT</span>
        <span className="fp-card-side-icon">↓</span>
      </button>

      {longTotal > 0 && (
        <div className="fp-card-position fp-card-position-heads">
          <span>● LONG</span><span>${longTotal.toFixed(2)}</span>
        </div>
      )}
      {shortTotal > 0 && (
        <div className="fp-card-position fp-card-position-tails">
          <span>● SHORT</span><span>${shortTotal.toFixed(2)}</span>
        </div>
      )}
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
    setFlash({ type: 'success', msg: `${side === 'heads' ? '↑ LONG' : '↓ SHORT'} #${epoch} · $${amount.toFixed(2)}` });
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

  // Honest balance pill rendering — never silent zero.
  const renderBalancePill = () => {
    if (!wallet.connected) {
      return (
        <div className="fp-bal fp-bal-connect" onClick={() => onConnectWallet?.()}>
          <span className="fp-bal-v">Connect</span>
        </div>
      );
    }
    const isLoading = balanceStatus === 'loading' || balanceStatus === 'idle';
    const isFail    = balanceStatus === 'fail';
    return (
      <div
        className={'fp-bal' + (isFail ? ' fp-bal-warn' : '')}
        title={isFail ? 'Solana devnet RPC declined the balance lookup' : undefined}
      >
        <span className="fp-bal-l">BAL</span>
        <span className={'fp-bal-v' + (isLoading ? ' fp-bal-loading' : '') + (isFail ? ' fp-bal-fail' : '')}>
          {isFail ? 'RPC DOWN' : isLoading ? '…' : '$' + balance.toFixed(2)}
        </span>
      </div>
    );
  };

  return (
    <div className="fp-page">
      <div className="fp-blob" style={{ width: 380, height: 380, background: '#FFE8F4', top: -100, left: -120 }}/>
      <div className="fp-blob" style={{ width: 420, height: 420, background: '#A0E7FF', top: '30%', right: -160, animationDelay: '3s' }}/>
      <div className="fp-blob" style={{ width: 300, height: 300, background: '#FFD46B', bottom: '10%', left: -80, animationDelay: '6s' }}/>

      {hasClaim && (
        <div className="fp-claim-banner" onClick={() => setRoundsOpen(true)}>
          <span>💰</span>
          <span>{claimableRounds.length} ROUND{claimableRounds.length > 1 ? 'S' : ''} READY TO COLLECT</span>
          <b className="fp-claim-banner-count">{claimableRounds.length}</b>
        </div>
      )}

      <div className="fp-page-inner">
        {flash && (
          <div className="fp-flash-top">
            <div className={'fp-flash ' + flash.type}>{flash.msg}</div>
          </div>
        )}

        <header className="fp-header">
          <div className="fp-brand">
            <div className="fp-mascot">F</div>
            <div className="fp-brand-text">
              <div className="fp-title">flipsy</div>
              <div className="fp-subtitle">Solana Sentiment</div>
            </div>
          </div>
          <div className="fp-actions">
            <button
              onClick={() => setRoundsOpen(true)}
              className={'fp-rounds-btn' + (hasClaim ? ' fp-has-claim' : '')}
            >
              {hasClaim ? '💰' : '📋'} Rounds
              {hasClaim && (<span className="fp-rounds-btn-count">{claimableRounds.length}</span>)}
            </button>

            {renderBalancePill()}
          </div>
        </header>

        <div className="fp-rounds-head">
          <h3 className="fp-rounds-title">
            {liveEpoch != null ? <>Round <em>#{liveEpoch}</em></> : <>Rounds</>}
          </h3>
          <span className="fp-rounds-sub">swipe <span className="arrow">←</span></span>
        </div>

        <div className="fp-carousel" ref={carouselRef}>
          {loading && nothingToShow && (
            <div className="fp-card fp-card-loading">Loading rounds…</div>
          )}
          {!loading && nothingToShow && chainError && (
            <div className="fp-card fp-card-empty err">
              <div className="fp-card-empty-icon">⚠️</div>
              <div className="fp-card-empty-title">Couldn't load rounds</div>
              <div className="fp-card-empty-msg">{chainError}</div>
            </div>
          )}
          {!loading && nothingToShow && !chainError && (
            <div className="fp-card fp-card-empty">
              <div className="fp-card-empty-icon">⏳</div>
              <div className="fp-card-empty-title">No active rounds</div>
              <div className="fp-card-empty-msg">New rounds start automatically. Hang tight.</div>
            </div>
          )}
          {[...recentRounds].reverse().map(r => (
            <RoundCard key={`prev-${r.epoch}`} round={r} state="previous"
              userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
              onSideTap={handleSideTap} claim={handleClaim} claimable={isClaimable(r)} />
          ))}
          {liveRound && (
            <RoundCard round={liveRound} state="live"
              userBets={getBetsForEpoch(liveRound.epoch)} livePrice={livePrice}
              onSideTap={handleSideTap} />
          )}
          {upcomingRounds[0] && (
            <RoundCard key={`next-${upcomingRounds[0].epoch}`} round={upcomingRounds[0]} state="next"
              userBets={getBetsForEpoch(upcomingRounds[0].epoch)} livePrice={livePrice}
              onSideTap={handleSideTap} />
          )}
          {upcomingRounds.slice(1).map(r => (
            <RoundCard key={`later-${r.epoch}`} round={r} state="later"
              userBets={getBetsForEpoch(r.epoch)} livePrice={livePrice}
              onSideTap={handleSideTap} />
          ))}
        </div>

        <div className="fp-footer">
          Powered by Solana · Non-custodial · 25% fee on wins only · No other fees
        </div>
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
