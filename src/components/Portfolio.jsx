// Portfolio.jsx — Solana wallet dashboard.
//
// REWRITE NOTES:
//   • One batched JSON-RPC call (SOL balance + both SPL programs) via /api/solana-rpc.
//     The server routes that to ALCHEMY_SOLANA_RPC (top priority in getSolanaRpcUrl).
//   • In parallel: Jupiter token meta (/api/jupiter/tokens/search) + Jupiter prices
//     direct from lite-api.jup.ag/price/v3 (CSP-permitted). Prices include SOL.
//   • One-shot render — full reveal when data arrives. No skeletons, no progressive
//     phases.
//   • Manual refresh only. No setInterval, no polling.
//   • Only shows SOL + tokens worth ≥ MIN_TOKEN_VALUE_USD ($1). SOL always shows.
//   • MoonPay CTA — "Buy Solana with USD", inline SVG logo, no external image.
//   • No Helius DAS, no fallbacks.
//   • Dropped @solana/web3.js PublicKey + useConnection — all RPC server-proxied.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

// =====================================================================
// INLINE CSS — Syne + JetBrains Mono · mint + violet, native dark
// =====================================================================
const PF_CSS = `
.pf-page{
  --pf-bg:#03060f; --pf-bg-2:#070b16;
  --pf-surface:#0a1020; --pf-surface-2:#0e1428;
  --pf-ink:#e6efff; --pf-ink-str:#f5fafe;
  --pf-muted:#7a92b3; --pf-muted-2:#475670;
  --pf-hl:#4dffd2; --pf-hl-2:#5ce9c8;
  --pf-hl-dim:rgba(77,255,210,.14);
  --pf-violet:#a87fff;
  --pf-sol:#9945ff;
  --pf-up:#3dd598; --pf-down:#ff8a9e;
  --pf-amber:#f5b53d; --pf-gold:#ffcd3c;
  --pf-moonpay:#7D00FE;
  --pf-border:rgba(255,255,255,.06);
  --pf-border-hi:rgba(77,255,210,.24);
  --pf-hairline:rgba(255,255,255,.05);

  --pf-font-display:'Syne',system-ui,sans-serif;
  --pf-font-body:'Syne',system-ui,sans-serif;
  --pf-font-mono:'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace;

  max-width:520px;margin:0 auto;width:100%;
  padding:0;
  color:var(--pf-ink);
  font-family:var(--pf-font-body);
  background-image:
    radial-gradient(ellipse 80% 40% at 50% -10%,rgba(77,255,210,.10),transparent 60%),
    radial-gradient(ellipse 60% 30% at 80% 20%,rgba(168,127,255,.06),transparent 50%);
}
.pf-page *{box-sizing:border-box}

@keyframes pf-spin{to{transform:rotate(360deg)}}
@keyframes pf-pulse{50%{opacity:.4}}

/* DISCONNECTED */
.pf-page-disconnected{max-width:520px}
.pf-disconnect-card{
  text-align:center;padding:60px 24px 40px;border-radius:26px;
  background:linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98));
  border:1.5px solid rgba(255,255,255,.07);
  box-shadow:0 20px 60px rgba(0,0,0,.55);
  margin-top:24px;
}
.pf-disconnect-icon{
  width:60px;height:60px;border-radius:50%;
  background:linear-gradient(135deg,var(--pf-hl) 0%,var(--pf-violet) 100%);
  margin:0 auto 18px;display:grid;place-items:center;color:#04070f;
  box-shadow:0 0 24px rgba(77,255,210,.3),0 0 48px rgba(77,255,210,.1);
}
.pf-disconnect-title{font-family:var(--pf-font-display);font-size:30px;font-weight:800;color:var(--pf-ink-str);margin:0 0 10px;letter-spacing:-.04em}
.pf-disconnect-italic{font-style:italic;font-weight:500;background:linear-gradient(135deg,var(--pf-hl) 0%,var(--pf-violet) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.pf-disconnect-sub{color:var(--pf-muted);font-size:13px;margin:0 0 28px;line-height:1.5}
.pf-disconnect-btn{
  background:linear-gradient(135deg,var(--pf-hl) 0%,var(--pf-violet) 100%);
  border:none;border-radius:16px;padding:16px 34px;color:#04070f;
  font-weight:900;font-size:15px;cursor:pointer;
  font-family:var(--pf-font-display);letter-spacing:.04em;
  box-shadow:0 8px 28px rgba(77,255,210,.35),0 4px 0 rgba(0,0,0,.25),inset 0 -3px 0 rgba(0,0,0,.12),inset 0 2px 0 rgba(255,255,255,.3);
  transition:transform .15s cubic-bezier(0.2,1.2,0.4,1);
}
.pf-disconnect-btn:active{transform:translateY(3px)}

/* WIDGET TITLE */
.pf-widget-title{display:flex;align-items:center;justify-content:space-between;padding:0 4px 12px;margin-top:-4px}
.pf-widget-title .nm{font-family:var(--pf-font-display);font-weight:800;font-size:20px;color:var(--pf-ink-str);letter-spacing:-.01em}

/* HERO */
.pf-hero{margin-top:0;padding:22px 20px;border-radius:22px;background:linear-gradient(145deg,rgba(14,20,40,.96),rgba(7,11,22,.98));border:1.5px solid rgba(255,255,255,.07);box-shadow:0 20px 60px rgba(0,0,0,.55);position:relative;overflow:hidden}
.pf-hero-glow-1{position:absolute;right:-50px;top:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(168,127,255,.16),transparent 65%);pointer-events:none}
.pf-hero-glow-2{position:absolute;left:-80px;bottom:-80px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(77,255,210,.12),transparent 65%);pointer-events:none}
.pf-hero-inner{position:relative}
.pf-hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.pf-status-pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(61,213,152,.08);border:1px solid rgba(61,213,152,.3)}
.pf-status-dot{width:6px;height:6px;border-radius:50%;background:var(--pf-up);box-shadow:0 0 8px var(--pf-up);animation:pf-pulse 1.8s ease-in-out infinite}
.pf-status-text{color:var(--pf-up);font-size:9px;font-weight:800;letter-spacing:.10em;font-family:var(--pf-font-mono)}
.pf-refresh-btn{background:rgba(77,255,210,.06);border:1px solid var(--pf-border-hi);border-radius:999px;width:34px;height:34px;padding:0;cursor:pointer;display:grid;place-items:center;color:var(--pf-hl);transition:all .15s}
.pf-refresh-btn:hover{background:rgba(77,255,210,.12);box-shadow:0 0 16px rgba(77,255,210,.2)}
.pf-refresh-btn:disabled{cursor:wait;opacity:.6}
.pf-refresh-btn.pf-spinning svg{animation:pf-spin 1s linear infinite}
.pf-portfolio-label{font-size:10px;color:var(--pf-muted-2);font-weight:700;letter-spacing:.14em;margin-bottom:4px;font-family:var(--pf-font-mono)}
.pf-portfolio-value{font-family:var(--pf-font-display);font-size:44px;font-weight:900;color:var(--pf-ink-str);letter-spacing:-.04em;line-height:1;margin-bottom:14px;font-variant-numeric:tabular-nums}
.pf-wallet-card{background:rgba(0,0,0,.30);border:1px solid var(--pf-border);border-radius:12px;padding:10px 13px;cursor:pointer;width:100%;display:flex;align-items:center;gap:10px;transition:border-color .15s;color:inherit;font-family:inherit}
.pf-wallet-card:hover{border-color:var(--pf-border-hi)}
.pf-wallet-icon{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--pf-sol),#7c3aed);display:grid;place-items:center;flex-shrink:0;box-shadow:0 2px 8px rgba(153,69,255,.4);color:#fff;font-size:11px;font-weight:800;font-family:var(--pf-font-display)}
.pf-wallet-info{flex:1;text-align:left;min-width:0}
.pf-wallet-label{font-size:9px;color:var(--pf-muted-2);font-weight:700;letter-spacing:.10em;font-family:var(--pf-font-mono)}
.pf-wallet-addr{font-size:11px;color:var(--pf-ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--pf-font-mono)}
.pf-copy-pill{font-size:9px;font-weight:800;color:var(--pf-hl);padding:5px 10px;border-radius:8px;background:var(--pf-hl-dim);border:1px solid var(--pf-border-hi);letter-spacing:.08em;flex-shrink:0;font-family:var(--pf-font-mono);transition:all .15s}
.pf-copy-pill.pf-copied{color:var(--pf-up);background:rgba(61,213,152,.10);border-color:rgba(61,213,152,.30)}

/* STATS */
.pf-stats{display:grid;gap:8px;margin-top:12px;margin-bottom:14px}
.pf-stats-2{grid-template-columns:repeat(2,1fr)}
.pf-stats-3{grid-template-columns:repeat(3,1fr)}
.pf-stat{padding:11px 13px;border-radius:12px;background:rgba(10,16,32,.50);border:1.5px solid var(--pf-border);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.pf-stat-label{font-size:9px;color:var(--pf-muted-2);font-weight:700;letter-spacing:.12em;font-family:var(--pf-font-mono)}
.pf-stat-val{font-family:var(--pf-font-display);font-size:18px;font-weight:900;line-height:1.1;margin-top:4px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pf-stat-sol{color:var(--pf-sol)}
.pf-stat-mint{color:var(--pf-hl)}
.pf-stat-amber{color:var(--pf-amber)}
.pf-stat-sub{font-size:10px;color:var(--pf-muted);margin-top:2px;font-weight:600;font-family:var(--pf-font-mono)}

/* MOONPAY CTA */
.pf-moonpay{
  display:flex;align-items:center;gap:12px;width:100%;
  padding:13px 16px;margin:0 0 16px;border-radius:14px;
  background:linear-gradient(135deg,#7D00FE 0%,#5A0EB8 100%);
  border:1px solid rgba(168,127,255,.45);
  text-decoration:none;color:#fff;font-family:inherit;
  box-shadow:0 6px 20px rgba(125,0,254,.30),inset 0 1px 0 rgba(255,255,255,.18);
  transition:transform .15s,box-shadow .15s;
}
.pf-moonpay:hover{transform:translateY(-1px);box-shadow:0 10px 28px rgba(125,0,254,.45),inset 0 1px 0 rgba(255,255,255,.22)}
.pf-moonpay:active{transform:translateY(0)}
.pf-moonpay-logo{width:34px;height:34px;border-radius:50%;background:#fff;display:grid;place-items:center;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.pf-moonpay-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start}
.pf-moonpay-title{font-family:var(--pf-font-display);font-weight:800;font-size:14px;letter-spacing:-.01em;color:#fff;line-height:1.15}
.pf-moonpay-sub{font-family:var(--pf-font-mono);font-size:10px;font-weight:600;color:rgba(255,255,255,.78);margin-top:2px;letter-spacing:.04em}
.pf-moonpay-arrow{font-size:16px;color:rgba(255,255,255,.85);flex-shrink:0;font-weight:700}

/* ERROR */
.pf-error{background:rgba(255,138,158,.08);border:1px solid rgba(255,138,158,.24);border-radius:12px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--pf-down);font-weight:600}

/* HOLDINGS HEAD */
.pf-holdings-head{display:flex;align-items:center;justify-content:space-between;padding:0 4px;margin-bottom:8px}
.pf-holdings-label{font-size:10px;color:var(--pf-muted-2);font-weight:800;letter-spacing:.15em;font-family:var(--pf-font-mono)}
.pf-holdings-meta{font-size:9px;color:var(--pf-muted-2);font-weight:600;letter-spacing:.05em;font-family:var(--pf-font-mono)}

/* LIST */
.pf-list{background:rgba(10,16,32,.50);border:1.5px solid var(--pf-border);border-radius:18px;overflow:hidden;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}

/* ROW */
.pf-row{padding:14px 18px;display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:center;border-bottom:1px solid var(--pf-hairline)}
.pf-row:last-child{border-bottom:none}
.pf-row-mid{min-width:0}
.pf-row-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pf-row-sym{color:var(--pf-ink-str);font-weight:800;font-size:14px;letter-spacing:-.01em;font-family:var(--pf-font-display)}
.pf-row-tag{color:var(--pf-hl);font-size:8px;font-weight:800;padding:2px 6px;border-radius:4px;background:var(--pf-hl-dim);border:1px solid var(--pf-border-hi);letter-spacing:.08em;font-family:var(--pf-font-mono)}
.pf-row-price{color:var(--pf-muted);font-size:10px;font-weight:600;font-family:var(--pf-font-mono)}
.pf-row-sub{color:var(--pf-muted);font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.pf-row-right{text-align:right}
.pf-row-value{color:var(--pf-ink-str);font-weight:800;font-size:14px;font-variant-numeric:tabular-nums;font-family:var(--pf-font-mono)}
.pf-row-value.pf-muted{color:var(--pf-muted)}
.pf-muted{color:var(--pf-muted)}

/* BADGE */
.pf-badge{border-radius:50%;display:grid;place-items:center;font-weight:900;flex-shrink:0;letter-spacing:-.02em;font-family:var(--pf-font-display)}
.pf-badge-img{border-radius:50%;flex-shrink:0;object-fit:cover;background:rgba(255,255,255,.04)}

/* EMPTY */
.pf-empty{padding:24px 18px;text-align:center}
.pf-empty-title{color:var(--pf-muted);font-size:12.5px;margin-bottom:6px;font-weight:700}
.pf-empty-sub{color:var(--pf-muted-2);font-size:11px;font-weight:500}

/* LOADING — one-shot reveal, no skeletons */
.pf-loading-card{padding:60px 24px;text-align:center}
.pf-loading-spinner{width:30px;height:30px;border-radius:50%;border:2.5px solid rgba(77,255,210,.15);border-top-color:var(--pf-hl);margin:0 auto 14px;animation:pf-spin .8s linear infinite}
.pf-loading-text{font-family:var(--pf-font-mono);font-size:10px;color:var(--pf-muted);font-weight:700;letter-spacing:.14em}

/* POWERED */
.pf-powered{display:flex;align-items:center;justify-content:center;gap:9px;padding:12px 16px;margin-top:18px;border-radius:14px;background:rgba(255,255,255,.02);border:1px solid var(--pf-border)}
.pf-powered-label{font-size:9px;color:var(--pf-muted-2);font-weight:700;letter-spacing:.08em;font-family:var(--pf-font-mono)}
.pf-powered-name{font-size:11px;font-weight:800;letter-spacing:.04em;background:linear-gradient(135deg,var(--pf-hl) 0%,var(--pf-violet) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-family:var(--pf-font-mono)}
.pf-powered-sep{color:var(--pf-muted-2);font-size:9px}
`;

function usePfCSS() {
  useEffect(() => {
    const id = 'nexus-pf-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = PF_CSS;
    document.head.appendChild(el);
  }, []);
}

// =====================================================================
// CONSTANTS
// =====================================================================
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_SOLANA = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// SPL program IDs as base58 strings — passed raw to JSON-RPC, no PublicKey wrapper.
const SPL_LEGACY_PROGRAM    = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Minimum USD value for a token row to render. SOL always shows regardless.
const MIN_TOKEN_VALUE_USD = 1;

// MoonPay buy URL — appends &walletAddress=... at render time when available.
const MOONPAY_BUY_BASE = 'https://buy.moonpay.com/?defaultCurrencyCode=sol';

const BRAND_TOKENS = {
  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB': { symbol:'TSLAx',  name:'Tesla',                color:'#e31837', textColor:'#fff', isBrand:true, decimals:8 },
  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp': { symbol:'AAPLx',  name:'Apple',                color:'#a2aaad', textColor:'#000', isBrand:true, decimals:8 },
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': { symbol:'NVDAx',  name:'NVIDIA',               color:'#76b900', textColor:'#000', isBrand:true, decimals:8 },
  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu': { symbol:'METAx',  name:'Meta Platforms',       color:'#0866ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN': { symbol:'GOOGLx', name:'Alphabet',             color:'#4285f4', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg': { symbol:'AMZNx',  name:'Amazon',               color:'#ff9900', textColor:'#000', isBrand:true, decimals:8 },
  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX': { symbol:'MSFTx',  name:'Microsoft',            color:'#00a4ef', textColor:'#fff', isBrand:true, decimals:8 },
  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL': { symbol:'NFLXx',  name:'Netflix',              color:'#e50914', textColor:'#fff', isBrand:true, decimals:8 },
  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4': { symbol:'PLTRx',  name:'Palantir',             color:'#404040', textColor:'#fff', isBrand:true, decimals:8 },
  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo': { symbol:'AVGOx',  name:'Broadcom',             color:'#cc092f', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu': { symbol:'COINx',  name:'Coinbase',             color:'#0052ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ': { symbol:'MSTRx',  name:'MicroStrategy',        color:'#fcb017', textColor:'#000', isBrand:true, decimals:8 },
  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1': { symbol:'CRCLx',  name:'Circle',               color:'#3399ff', textColor:'#fff', isBrand:true, decimals:8 },
  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg': { symbol:'HOODx',  name:'Robinhood',            color:'#cdff00', textColor:'#000', isBrand:true, decimals:8 },
  'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W': { symbol:'SPYx',   name:'S&P 500 Index',        color:'#1c4f9c', textColor:'#fff', isBrand:true, decimals:8 },
  'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ': { symbol:'QQQx',   name:'Nasdaq 100 Index',     color:'#003b71', textColor:'#fff', isBrand:true, decimals:8 },
  'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re': { symbol:'GLDx',   name:'Gold',                 color:'#d4af37', textColor:'#000', isBrand:true, decimals:8 },
  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp': { symbol:'TBLLx',  name:'Short-Term Treasury',  color:'#2a4d6e', textColor:'#fff', isBrand:true, decimals:8 },
};

const CORE_TOKENS = {
  [SOL_MINT]:    { symbol:'SOL',  name:'Solana',     color:'#9945ff', textColor:'#fff' },
  [USDC_SOLANA]: { symbol:'USDC', name:'USD Coin',   color:'#2775ca', textColor:'#fff', isStable:true },
  [USDT_SOLANA]: { symbol:'USDT', name:'Tether USD', color:'#26a17b', textColor:'#fff', isStable:true },
};

// =====================================================================
// UTILS
// =====================================================================
function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 1e9)   return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)   return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: d });
  if (n >= 1)     return '$' + n.toFixed(d);
  if (n > 0)      return '$' + n.toFixed(6);
  return '$0.00';
}
function fmtTokenAmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  n = Number(n);
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  if (n > 0)     return n.toFixed(6);
  return '0';
}
function shortAddr(s) {
  if (!s || typeof s !== 'string') return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '...' + s.slice(-4);
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    return true;
  } catch { return false; }
}
function colorFromMint(mint) {
  const seed = mint || '?';
  const hue = Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// =====================================================================
// META HELPERS
// =====================================================================
function getCoreMeta(mint) {
  if (BRAND_TOKENS[mint]) return BRAND_TOKENS[mint];
  if (CORE_TOKENS[mint])  return CORE_TOKENS[mint];
  return null;
}
function buildFallbackMeta(mint) {
  return {
    symbol:    (mint || '').slice(0, 4) + '...',
    name:      'SPL Token',
    color:     colorFromMint(mint),
    textColor: '#fff',
    icon:      null,
  };
}

// =====================================================================
// PORTFOLIO FETCH — one batched RPC, then parallel meta + prices.
// Throws on RPC failure; meta/price failures degrade silently to 0.
// =====================================================================
async function fetchPortfolio(addressStr) {
  // Phase 1 — batched JSON-RPC (SOL balance + both SPL programs)
  const rpcBatch = [
    { jsonrpc: '2.0', id: 1, method: 'getBalance',
      params: [addressStr] },
    { jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
      params: [addressStr, { programId: SPL_LEGACY_PROGRAM },    { encoding: 'jsonParsed' }] },
    { jsonrpc: '2.0', id: 3, method: 'getTokenAccountsByOwner',
      params: [addressStr, { programId: SPL_TOKEN2022_PROGRAM }, { encoding: 'jsonParsed' }] },
  ];

  const rpcResp = await fetch('/api/solana-rpc', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(rpcBatch),
  });
  if (!rpcResp.ok) throw new Error('RPC HTTP ' + rpcResp.status);
  const rpcJson = await rpcResp.json();
  if (!Array.isArray(rpcJson)) throw new Error('RPC: expected batch array');

  // Match responses by id — Solana RPC may reorder batch items.
  const byId = {};
  for (const item of rpcJson) {
    if (item && item.id != null) byId[item.id] = item;
  }

  // getBalance → { result: { context, value: lamports } }
  const lamports = Number(byId[1]?.result?.value || 0);

  // getTokenAccountsByOwner → { result: { context, value: [...] } }
  const legacyAccounts  = byId[2]?.result?.value || [];
  const token22Accounts = byId[3]?.result?.value || [];
  const allAccounts     = legacyAccounts.concat(token22Accounts);

  // Phase 2 — aggregate by mint (a wallet can have multiple accounts per mint)
  const byMint = {};
  for (const acc of allAccounts) {
    try {
      const info = acc.account.data.parsed.info;
      const ta   = info.tokenAmount || {};
      const ui   = Number(ta.uiAmountString || ta.uiAmount || 0);
      const mint = info.mint;
      if (!mint || !Number.isFinite(ui) || ui <= 0) continue;
      if (!byMint[mint]) {
        byMint[mint] = {
          mint,
          uiAmount: 0,
          decimals: Number.isFinite(Number(ta.decimals)) ? Number(ta.decimals) : 6,
        };
      }
      byMint[mint].uiAmount += ui;
    } catch {}
  }

  const tokenMints = Object.keys(byMint).filter(m => m !== SOL_MINT);

  // Phase 3 — meta + prices in parallel. Prices request includes SOL.
  const [metaMap, priceMap] = await Promise.all([
    fetchMetaBatched(tokenMints),
    fetchPricesBatched([SOL_MINT, ...tokenMints]),
  ]);

  // Phase 4 — enrich, threshold-filter, sort
  const enriched = Object.values(byMint).map(h => {
    const core    = getCoreMeta(h.mint);
    const fetched = metaMap[h.mint];
    const meta    = core || fetched || buildFallbackMeta(h.mint);
    const price   = meta.isStable ? 1 : (priceMap[h.mint] || 0);
    return { ...h, meta, price, value: h.uiAmount * price };
  });

  const filtered = enriched
    .filter(h => h.mint !== SOL_MINT)
    .filter(h => h.value >= MIN_TOKEN_VALUE_USD);

  filtered.sort((a, b) => {
    const rank = m => m.isStable ? 0 : m.isBrand ? 1 : 2;
    const ra = rank(a.meta), rb = rank(b.meta);
    if (ra !== rb) return ra - rb;
    return b.value - a.value;
  });

  return {
    solBalance:  lamports / 1e9,
    solPriceUsd: priceMap[SOL_MINT] || 0,
    tokens:      filtered,
  };
}

// Chunked at 100 mints (Jupiter URL length safety). Parallel.
async function fetchMetaBatched(mints) {
  const out = {};
  if (!mints.length) return out;
  const chunks = [];
  for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await fetch(`/api/jupiter/tokens/search?query=${encodeURIComponent(chunk.join(','))}`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : (data?.tokens || []);
    } catch { return []; }
  }));
  for (const list of results) {
    for (const t of list) {
      const m = t.id || t.address || t.mint;
      if (!m) continue;
      out[m] = {
        symbol:    t.symbol || (m.slice(0, 4) + '...'),
        name:      t.name   || 'SPL Token',
        icon:      t.icon || t.logoURI || null,
        decimals:  Number.isFinite(t.decimals) ? t.decimals : 6,
        color:     colorFromMint(m),
        textColor: '#fff',
      };
    }
  }
  return out;
}

async function fetchPricesBatched(mints) {
  const out = {};
  if (!mints.length) return out;
  const chunks = [];
  for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${chunk.join(',')}`);
      if (!r.ok) return {};
      return await r.json();
    } catch { return {}; }
  }));
  for (const j of results) {
    for (const [m, info] of Object.entries(j || {})) {
      const p = Number(info?.usdPrice);
      if (Number.isFinite(p) && p > 0) out[m] = p;
    }
  }
  return out;
}

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function TokenBadge({ meta, mint, size = 36 }) {
  const [errored, setErrored] = useState(false);
  if (meta?.icon && !errored) {
    return (
      <img
        src={meta.icon}
        alt={meta.symbol || ''}
        onError={() => setErrored(true)}
        className="pf-badge-img"
        style={{ width: size, height: size }}
      />
    );
  }
  const letter = ((meta?.symbol || '?').replace(/x$/, '').charAt(0) || '?').toUpperCase();
  const color  = meta?.color || colorFromMint(mint);
  return (
    <div
      className="pf-badge"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        color: meta?.textColor || '#fff',
        fontSize: Math.round(size * 0.38),
        boxShadow: `0 4px 12px ${color}40`,
      }}
    >{letter}</div>
  );
}

function TokenRow({ token }) {
  const meta    = token.meta || buildFallbackMeta(token.mint);
  const val     = token.value || 0;
  const isBrand = !!meta.isBrand;
  return (
    <div className="pf-row">
      <TokenBadge meta={meta} mint={token.mint} size={36}/>
      <div className="pf-row-mid">
        <div className="pf-row-head">
          <span className="pf-row-sym">{meta.symbol}</span>
          {isBrand && (<span className="pf-row-tag">BRAND</span>)}
          <span className="pf-row-price">
            {token.price > 0 ? fmt(token.price) : '—'}
          </span>
        </div>
        <div className="pf-row-sub">
          {fmtTokenAmt(token.uiAmount)} {meta.symbol} · {meta.name}
        </div>
      </div>
      <div className="pf-row-right">
        <div className={'pf-row-value' + (val > 0 ? '' : ' pf-muted')}>
          {val > 0 ? fmt(val) : '—'}
        </div>
      </div>
    </div>
  );
}

// MoonPay CTA — inline SVG logo, no external image dependency.
// The "M" mark is rendered as a path so there's no broken-image risk and
// no extra network request.
function MoonPayButton({ walletAddress }) {
  const url = walletAddress
    ? `${MOONPAY_BUY_BASE}&walletAddress=${encodeURIComponent(walletAddress)}`
    : MOONPAY_BUY_BASE;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="pf-moonpay">
      <span className="pf-moonpay-logo" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#7D00FE"/>
          <path
            d="M9.6 22V10h3.1l3.3 5.6L19.3 10h3.1v12h-2.9v-7.6l-2.7 4.5h-1.6l-2.7-4.5V22H9.6Z"
            fill="#fff"
          />
        </svg>
      </span>
      <span className="pf-moonpay-text">
        <span className="pf-moonpay-title">Buy Solana with USD</span>
        <span className="pf-moonpay-sub">Card · Apple Pay · Bank transfer</span>
      </span>
      <span className="pf-moonpay-arrow">↗</span>
    </a>
  );
}

// =====================================================================
// MAIN
// =====================================================================
export default function Portfolio({ onConnectWallet }) {
  usePfCSS();

  const { publicKey: extPk, connected: solCon } = useWallet();
  const addressStr = useMemo(() => extPk ? extPk.toString() : null, [extPk]);

  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(false);

  const inFlightRef = useRef(false);

  const load = useCallback(async (isInitial) => {
    if (!addressStr) { setLoading(false); return; }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!isInitial) setRefreshing(true);
    setError('');
    try {
      const result = await fetchPortfolio(addressStr);
      setData(result);
    } catch (e) {
      console.warn('[portfolio]', e);
      setError('Failed to load wallet');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [addressStr]);

  // Fetch once on connect / address change. NO polling.
  useEffect(() => {
    if (!addressStr) { setLoading(false); setData(null); return; }
    setLoading(true);
    setData(null);
    load(true);
  }, [addressStr, load]);

  const handleRefresh = useCallback(() => load(false), [load]);

  const handleCopyAddr = useCallback(async () => {
    if (!addressStr) return;
    if (await copyText(addressStr)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }, [addressStr]);

  // ===================================================================
  // DISCONNECTED
  // ===================================================================
  if (!solCon) {
    return (
      <div className="pf-page pf-page-disconnected">
        <div className="pf-disconnect-card">
          <div className="pf-disconnect-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="2" y="6" width="20" height="14" rx="2"/>
              <path d="M2 12h20"/>
            </svg>
          </div>
          <h1 className="pf-disconnect-title">
            Connect your{' '}
            <span className="pf-disconnect-italic">wallet</span>
          </h1>
          <p className="pf-disconnect-sub">See your SOL and meaningful holdings in one place.</p>
          <button onClick={() => onConnectWallet?.()} className="pf-disconnect-btn">Connect Wallet</button>
        </div>
      </div>
    );
  }

  // ===================================================================
  // CONNECTED — LOADING (one-shot reveal, no skeletons)
  // ===================================================================
  if (loading && !data) {
    return (
      <div className="pf-page">
        <div className="pf-widget-title">
          <div className="nm">Wallet</div>
        </div>
        <div className="pf-hero">
          <div className="pf-loading-card">
            <div className="pf-loading-spinner"/>
            <div className="pf-loading-text">LOADING WALLET</div>
          </div>
        </div>
      </div>
    );
  }

  // ===================================================================
  // CONNECTED — READY
  // ===================================================================
  const solBalance  = data?.solBalance  || 0;
  const solPriceUsd = data?.solPriceUsd || 0;
  const tokens      = data?.tokens      || [];

  const solValue    = solBalance * solPriceUsd;
  const tokensTotal = tokens.reduce((s, h) => s + (h.value || 0), 0);
  const totalValue  = solValue + tokensTotal;
  const tokenCount  = tokens.length + (solBalance > 0 ? 1 : 0);
  const brandsCount = tokens.filter(t => t.meta.isBrand).length;

  const solMeta = CORE_TOKENS[SOL_MINT];

  return (
    <div className="pf-page">
      <div className="pf-widget-title">
        <div className="nm">Wallet</div>
      </div>

      <div className="pf-hero">
        <div className="pf-hero-glow-1"/>
        <div className="pf-hero-glow-2"/>
        <div className="pf-hero-inner">
          <div className="pf-hero-top">
            <div className="pf-status-pill">
              <span className="pf-status-dot"/>
              <span className="pf-status-text">SOLANA · MAINNET</span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={'pf-refresh-btn' + (refreshing ? ' pf-spinning' : '')}
              aria-label="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>

          <div className="pf-portfolio-label">PORTFOLIO VALUE</div>
          <div className="pf-portfolio-value">{fmt(totalValue)}</div>

          <button onClick={handleCopyAddr} className="pf-wallet-card">
            <div className="pf-wallet-icon"><span>S</span></div>
            <div className="pf-wallet-info">
              <div className="pf-wallet-label">WALLET ADDRESS</div>
              <div className="pf-wallet-addr">{shortAddr(addressStr)}</div>
            </div>
            <span className={'pf-copy-pill' + (copied ? ' pf-copied' : '')}>
              {copied ? 'COPIED' : 'COPY'}
            </span>
          </button>
        </div>
      </div>

      <div className={'pf-stats' + (brandsCount > 0 ? ' pf-stats-3' : ' pf-stats-2')}>
        <div className="pf-stat">
          <div className="pf-stat-label">SOL</div>
          <div className="pf-stat-val pf-stat-sol">{solBalance.toFixed(3)}</div>
          <div className="pf-stat-sub">{solValue > 0 ? fmt(solValue) : '—'}</div>
        </div>
        <div className="pf-stat">
          <div className="pf-stat-label">HOLDINGS</div>
          <div className="pf-stat-val pf-stat-mint">{tokenCount}</div>
          <div className="pf-stat-sub">{tokenCount === 1 ? 'asset' : 'assets'}</div>
        </div>
        {brandsCount > 0 && (
          <div className="pf-stat">
            <div className="pf-stat-label">BRANDS</div>
            <div className="pf-stat-val pf-stat-amber">{brandsCount}</div>
            <div className="pf-stat-sub">{brandsCount === 1 ? 'brand' : 'brands'}</div>
          </div>
        )}
      </div>

      <MoonPayButton walletAddress={addressStr}/>

      {error && (<div className="pf-error">{error}</div>)}

      <div className="pf-holdings-head">
        <div className="pf-holdings-label">HOLDINGS</div>
        <div className="pf-holdings-meta">JUPITER PRICES</div>
      </div>

      <div className="pf-list">
        <TokenRow token={{
          mint:     SOL_MINT,
          meta:     solMeta,
          price:    solPriceUsd,
          value:    solValue,
          uiAmount: solBalance,
        }}/>

        {tokens.length === 0 ? (
          <div className="pf-empty">
            <div className="pf-empty-title">No tokens worth showing.</div>
            <div className="pf-empty-sub">Holdings under ${MIN_TOKEN_VALUE_USD} are hidden.</div>
          </div>
        ) : tokens.map(token => (
          <TokenRow key={token.mint} token={token}/>
        ))}
      </div>

      <div className="pf-powered">
        <span className="pf-powered-label">POWERED BY</span>
        <span className="pf-powered-name">ALCHEMY · JUPITER</span>
        <span className="pf-powered-sep">|</span>
        <span className="pf-powered-label">NON-CUSTODIAL</span>
      </div>
    </div>
  );
}
