// ReferralsPage.jsx — the referrals landing page at /referrals.
//
// A standalone, self-contained page: the user connects their MAIN wallet here
// and does everything referral-related — grab their link, watch earnings land
// (50% of every fee, on-chain, same block), activate a KOL boost code, and see
// where they sit on the standings. No burner, no signup.
//
// Self-contained: the only externals are react + @solana/wallet-adapter-react
// (for the connected wallet) and the same /api/ref/* backend routes the rest of
// the app already uses. Connect is delegated to the app shell via the
// onConnectWallet prop (App.js passes it). Reads the connected wallet with
// useWallet(), exactly like LaunchRadar / SwapWidget.

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

/* ============================================================
   SELF-CONTAINED HELPERS (formatters · share intents · icons)
   ============================================================ */
const lamportsToSol = (l) => Number(l || 0) / 1e9;
const truncWallet = (w) => (w ? w.slice(0, 4) + '…' + w.slice(-4) : '');
function format(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function formatSol(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.001) return n.toFixed(4);
  return n.toFixed(6);
}
function formatSolSigned(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  return (n >= 0 ? '+' : '-') + formatSol(Math.abs(n));
}

function inviteUrl(walletStr) {
  if (typeof window === 'undefined' || !walletStr) return '';
  return window.location.origin + '/?ref=' + walletStr;
}
function openTwitterShare(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ text }); if (url) params.set('url', url);
  window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer,width=600,height=500');
}
function openTelegram(text, url) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ url: url || '', text });
  window.open('https://t.me/share/url?' + params, '_blank', 'noopener,noreferrer');
}
async function copyToClipboard(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

const IconX = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>);
const IconTg = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" /></svg>);
const IconDs = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>);

/* ============================================================
   CSS — Wonderland-light palette, matches /why and the app
   ============================================================ */
const RFP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

.rfp-root{
  --ink:#0b0b0c; --ink2:#86868b; --ink3:#aeaeb2;
  --greent:#11b87f; --green:#16c08a; --red:#f0425a; --gold:#a67200;
  --fill:#f4f4f5; --fill2:#fafafa; --hairline:#f1f1f2; --border:#e9e9eb;
  max-width:720px; margin:0 auto; padding:24px 18px 96px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  color:var(--ink); background:#ffffff; -webkit-font-smoothing:antialiased;
}
.rfp-root,.rfp-root *{box-sizing:border-box}
.rfp-root [class*="num"],.rfp-stat-v,.rfp-lb-vol,.rfp-link-v{font-variant-numeric:tabular-nums}
@keyframes rfp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes rfp-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes rfp-spin{to{transform:rotate(360deg)}}

.rfp-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);background:var(--fill);padding:6px 12px;border-radius:999px}
.rfp-eyebrow .d{width:5px;height:5px;border-radius:50%;background:var(--green);animation:rfp-pulse 1.4s infinite}
.rfp-h1{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:16px 0 12px}
.rfp-h1 .it{font-style:normal;color:var(--ink2)}
.rfp-sub{font-size:15px;line-height:1.55;color:var(--ink2);font-weight:500;margin:0}
.rfp-sub b{color:var(--ink);font-weight:700}
@media(max-width:600px){.rfp-root{padding:20px 14px 96px}.rfp-h1{font-size:28px}.rfp-sub{font-size:14px}}

/* connect hero */
.rfp-connect{margin-top:20px;padding:26px 22px;border-radius:20px;background:#0b0b0c;text-align:center}
.rfp-connect-h{font-size:22px;font-weight:800;letter-spacing:-.02em;color:#fff;margin:0}
.rfp-connect-h .it{font-style:normal;color:rgba(255,255,255,.55)}
.rfp-connect-s{font-size:13px;line-height:1.5;color:rgba(255,255,255,.6);font-weight:500;margin:8px auto 18px;max-width:380px}
.rfp-connect-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;color:#0b0b0c;border:none;border-radius:999px;padding:14px 28px;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer;transition:opacity .14s}
.rfp-connect-btn:hover{opacity:.9}
.rfp-connect-foot{font-size:10px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.45);margin-top:13px;text-transform:uppercase}

/* divider */
.rfp-divider{display:flex;align-items:center;gap:12px;margin:30px 0 14px}
.rfp-divider .rule{flex:1;height:1px;background:var(--hairline)}
.rfp-divider .label{font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}

/* cards */
.rfp-card{border:1px solid var(--hairline);border-radius:16px;padding:16px;background:#fff;margin-top:12px;box-shadow:0 1px 2px rgba(11,11,12,.04);animation:rfp-rise .4s cubic-bezier(.2,1,.3,1) backwards}
.rfp-card.feature{background:var(--fill2)}
.rfp-card-eye{display:flex;align-items:center;gap:7px;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);margin-bottom:11px}
.rfp-card-eye span:first-child{color:var(--greent)}

/* referral link */
.rfp-link{display:flex;gap:8px}
.rfp-link-v{flex:1;min-width:0;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--border);border-radius:11px;padding:12px 13px;outline:none;overflow:hidden;text-overflow:ellipsis}
.rfp-link-v:focus{border-color:var(--ink3)}
.rfp-link-cp{flex-shrink:0;font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.04em;color:#fff;background:#0b0b0c;border:none;border-radius:11px;padding:0 16px;cursor:pointer;transition:opacity .14s}
.rfp-link-cp:hover{opacity:.9}
.rfp-link-cp.copied{background:var(--greent)}
.rfp-share-row{display:flex;gap:8px;margin-top:10px}
.rfp-sh{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;font-size:12px;font-weight:700;border:none;border-radius:11px;padding:11px 0;color:#fff;cursor:pointer;transition:opacity .16s}
.rfp-sh:hover{opacity:.9}
.rfp-sh .ico{width:14px;height:14px;display:inline-flex}
.rfp-sh .ico svg{width:100%;height:100%}
.rfp-sh.tw{background:#0b0b0c}
.rfp-sh.tg{background:#229ED9}
.rfp-sh.ds{background:#5865F2}
.rfp-sh.ds.done{background:var(--greent)}
@media(max-width:600px){.rfp-share-row{flex-wrap:wrap}.rfp-sh{flex:1 1 100%}}

/* stats */
.rfp-stats{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:12px}
@media(max-width:640px){.rfp-stats{grid-template-columns:1fr 1fr}}
.rfp-stat{border:1px solid var(--hairline);border-radius:14px;padding:13px 14px;background:#fff}
.rfp-stat-l{display:flex;align-items:center;gap:5px;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3)}
.rfp-stat-l .gl{color:var(--ink2)}
.rfp-stat-v{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:7px;line-height:1;color:var(--ink)}
.rfp-stat-v.gn{color:var(--greent)}
.rfp-stat-v.it{color:var(--ink3)}
.rfp-stat-v .u{font-size:11px;font-weight:700;color:var(--ink3);margin-left:3px}
.rfp-stat-m{font-size:10.5px;font-weight:500;color:var(--ink2);margin-top:6px;line-height:1.35}

/* boost code */
.rfp-boost-row{display:flex;gap:8px}
.rfp-boost-in{flex:1;min-width:0;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);background:#fff;border:1px solid var(--border);border-radius:11px;padding:12px 13px;outline:none}
.rfp-boost-in:focus{border-color:var(--ink3)}
.rfp-boost-btn{flex-shrink:0;font-family:inherit;font-size:12px;font-weight:800;color:#fff;background:#0b0b0c;border:none;border-radius:11px;padding:0 18px;cursor:pointer;transition:opacity .14s}
.rfp-boost-btn:hover{opacity:.9}
.rfp-boost-btn:disabled{opacity:.5;cursor:wait}
.rfp-boost-msg{margin-top:10px;font-size:12px;font-weight:600;line-height:1.45}
.rfp-boost-msg.ok{color:var(--greent)}
.rfp-boost-msg.bad{color:var(--red)}
.rfp-boost-sub{font-size:11.5px;line-height:1.5;color:var(--ink2);font-weight:500;margin:0 0 11px}
.rfp-boost-live{display:inline-flex;align-items:center;gap:6px;margin-top:11px;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--greent);background:rgba(22,192,138,.12);padding:6px 11px;border-radius:999px}

/* rules */
.rfp-rules{display:flex;flex-direction:column;gap:14px}
.rfp-rule{display:flex;gap:13px}
.rfp-rule .n{flex-shrink:0;width:28px;height:28px;border-radius:8px;background:#0b0b0c;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}
.rfp-rule .rh{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:3px 0 5px;color:var(--ink)}
.rfp-rule .rh .it{font-style:normal;color:var(--ink2)}
.rfp-rule .rb{font-size:12.5px;line-height:1.5;color:var(--ink2);font-weight:500;margin:0}
.rfp-rule .rb b{color:var(--ink);font-weight:700}

/* leaderboard */
.rfp-win-tabs{display:flex;gap:6px;margin-top:6px}
.rfp-win-tab{flex:1;font-family:inherit;font-size:12px;font-weight:800;color:var(--ink2);background:var(--fill);border:none;border-radius:10px;padding:9px 0;cursor:pointer;transition:.12s}
.rfp-win-tab.on{background:#0b0b0c;color:#fff}
.rfp-lb-frame{border:1px solid var(--hairline);border-radius:16px;overflow:hidden;margin-top:12px}
.rfp-lb-row{display:grid;grid-template-columns:64px 1fr 110px 70px;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--hairline);font-size:13px}
.rfp-lb-row:last-child{border-bottom:none}
.rfp-lb-row.thead{background:var(--fill2);font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.rfp-lb-row.mine{background:rgba(22,192,138,.07)}
.rfp-lb-rank{font-weight:800;color:var(--ink2);font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;gap:3px}
.rfp-lb-rank .hash{color:var(--ink3);font-size:10px}
.rfp-lb-rank.gold{color:var(--gold)}
.rfp-lb-rank.silver{color:#8a8a90}
.rfp-lb-rank.bronze{color:#a0673a}
.rfp-lb-w{font-weight:700;color:var(--ink);display:inline-flex;align-items:center;gap:7px;min-width:0;overflow:hidden}
.rfp-lb-w .you{flex-shrink:0;font-size:8.5px;font-weight:800;letter-spacing:.06em;color:var(--greent);background:rgba(22,192,138,.14);padding:2px 6px;border-radius:5px}
.rfp-lb-vol{text-align:right;font-weight:800;color:var(--ink)}
.rfp-lb-vol .u{font-size:10px;font-weight:700;color:var(--ink3)}
.rfp-lb-tr{text-align:right;font-weight:700;color:var(--ink2)}
.rfp-lb-foot{display:flex;justify-content:space-between;gap:8px;padding:12px 16px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3);background:var(--fill2)}
@media(max-width:560px){.rfp-lb-row{grid-template-columns:52px 1fr 96px;gap:8px;padding:12px 14px}.rfp-lb-tr,.rfp-col-tr{display:none}}

/* empty / loading */
.rfp-empty{padding:30px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
.rfp-empty .gl{font-size:24px;opacity:.5}
.rfp-empty .h{font-size:15px;font-weight:700;color:var(--ink);display:inline-flex;align-items:center;gap:8px}
.rfp-empty .h .it{font-style:normal;color:var(--ink2)}
.rfp-empty .e{font-size:11px;color:var(--ink3);font-weight:600}
.rfp-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--hairline);border-top-color:#0b0b0c;animation:rfp-spin .8s linear infinite;display:inline-block}
`;

function useRfpCss() {
  useEffect(() => {
    const id = 'referrals-page-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = RFP_CSS;
    document.head.appendChild(el);
  }, []);
}

/* ============================================================
   STANDINGS (public — works connected or not)
   ============================================================ */
function Standings({ walletStr, lb, lbLoading, lbError, win, setWin }) {
  return (
    <>
      <div className="rfp-divider"><span className="rule" /><span className="label">The field, ranked</span><span className="rule" /></div>
      <p className="rfp-sub">Top traders by SOL volume routed through Nexus. Refreshes every 30 seconds.</p>
      <div className="rfp-win-tabs">
        <button className={'rfp-win-tab' + (win === '24h' ? ' on' : '')} onClick={() => setWin('24h')}>24 hours</button>
        <button className={'rfp-win-tab' + (win === '7d' ? ' on' : '')} onClick={() => setWin('7d')}>7 days</button>
        <button className={'rfp-win-tab' + (win === 'all' ? ' on' : '')} onClick={() => setWin('all')}>All time</button>
      </div>
      <div className="rfp-lb-frame">
        <div className="rfp-lb-row thead"><span>Rank</span><span>Trader</span><span style={{ textAlign: 'right' }}>Volume</span><span className="rfp-col-tr" style={{ textAlign: 'right' }}>Trades</span></div>
        {lbError ? (
          <div className="rfp-empty"><span className="gl">⊘</span><div className="h">Standings unreachable</div><div className="e">{lbError}</div></div>
        ) : lbLoading && !lb ? (
          <div className="rfp-empty"><span className="gl">⏳</span><div className="h"><span className="rfp-spin" />Counting the field…</div></div>
        ) : !lb || lb.count === 0 ? (
          <div className="rfp-empty"><span className="gl">∅</span><div className="h">No <span className="it">trades</span> logged in this window</div></div>
        ) : (
          <>
            {lb.traders.map((t, i) => {
              const rank = i + 1;
              const mine = walletStr && t.wallet === walletStr;
              const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
              return (
                <div className={'rfp-lb-row' + (mine ? ' mine' : '')} key={t.wallet}>
                  <span className={'rfp-lb-rank ' + rankClass}><span className="hash">№</span>{rank.toString().padStart(2, '0')}</span>
                  <span className="rfp-lb-w">{truncWallet(t.wallet)}{mine ? <span className="you">YOU</span> : null}</span>
                  <span className="rfp-lb-vol">{formatSol(t.volume_sol)}<span className="u"> SOL</span></span>
                  <span className="rfp-lb-tr rfp-col-tr">{t.trades}</span>
                </div>
              );
            })}
            <div className="rfp-lb-foot"><span>{lb.total_traders || lb.count} traders · top 50</span><span>{new Date(lb.ts || Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
          </>
        )}
      </div>
    </>
  );
}

/* ============================================================
   HOW IT WORKS (static, shown always)
   ============================================================ */
function HowItWorks() {
  return (
    <div className="rfp-card">
      <div className="rfp-card-eye"><span>§</span><span>How the line pays</span></div>
      <div className="rfp-rules">
        <div className="rfp-rule"><div className="n">01</div><div><div className="rh">Someone follows your <span className="it">link.</span></div><div className="rb">They land on Nexus with your wallet attached. The first time they trade, you're locked in as their referrer — <b>permanently</b>.</div></div></div>
        <div className="rfp-rule"><div className="n">02</div><div><div className="rh">They <span className="it">trade.</span> You're paid the same block.</div><div className="rb">Each trade carries a 3% platform fee. <b>50% is sent straight to your wallet</b> as part of the same on-chain transaction.</div></div></div>
        <div className="rfp-rule"><div className="n">03</div><div><div className="rh">No withdrawals. No <span className="it">claims.</span></div><div className="rb">Earnings are already in this wallet the moment each trade confirms. There's nothing to withdraw because nothing is ever held.</div></div></div>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE
   ============================================================ */
export default function ReferralsPage({ onConnectWallet }) {
  useRfpCss();
  const { publicKey, connected } = useWallet();
  const walletStr = (connected && publicKey && typeof publicKey.toBase58 === 'function') ? publicKey.toBase58() : '';

  const [copied, setCopied] = useState(false);
  const [dcDone, setDcDone] = useState(false);

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [lb, setLb] = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(null);
  const [lbWin, setLbWin] = useState('24h');

  const [boostInput, setBoostInput] = useState('');
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostMsg, setBoostMsg] = useState(null);

  const link = inviteUrl(walletStr);
  const inviteTweet = "I've been trading on Nexus — no signup, burner wallet, 2-second trades, honest reads. Follow my line:";

  // Live referral stats for the connected wallet.
  useEffect(() => {
    if (!walletStr) { setStats(null); setStatsError(null); return; }
    let cancelled = false;
    const load = async () => {
      setStatsLoading(true);
      try {
        const r = await fetch('/api/ref/stats?wallet=' + encodeURIComponent(walletStr));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!cancelled) { setStats(d); setStatsError(null); }
      } catch (e) {
        if (!cancelled) setStatsError(String((e && e.message) || 'Network').slice(0, 120));
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletStr, refreshKey]);

  // Public standings (no wallet needed).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLbLoading(true);
      try {
        const r = await fetch('/api/ref/leaderboard?window=' + lbWin);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!cancelled) { setLb(d); setLbError(null); }
      } catch (e) {
        if (!cancelled) setLbError(String((e && e.message) || 'Network').slice(0, 120));
      } finally {
        if (!cancelled) setLbLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [lbWin]);

  const copyLink = useCallback(async () => {
    if (await copyToClipboard(link)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }, [link]);

  const shareDiscord = useCallback(async () => {
    if (await copyToClipboard(inviteTweet + '\n' + link)) { setDcDone(true); setTimeout(() => setDcDone(false), 1800); }
  }, [link]);

  const activateBoost = useCallback(async () => {
    const code = boostInput.trim().toUpperCase();
    if (!code || !walletStr || boostBusy) return;
    setBoostBusy(true); setBoostMsg(null);
    try {
      const r = await fetch('/api/ref/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletStr, boost: code }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.boostActivated) {
        setBoostMsg({ ok: true, text: 'Boost activated — better split for 60 days.' });
        setBoostInput(''); setRefreshKey(k => k + 1);
      } else if (d && d.boosted) {
        setBoostMsg({ ok: true, text: 'A boost is already active on this wallet.' });
      } else {
        setBoostMsg({ ok: false, text: "That code isn't valid, or a boost was already used on this wallet." });
      }
    } catch (e) {
      setBoostMsg({ ok: false, text: "Couldn't reach the server — try again." });
    } finally {
      setBoostBusy(false);
    }
  }, [boostInput, walletStr, boostBusy]);

  const earnedSol = lamportsToSol(stats && stats.earned_lamports);
  const earned7dSol = lamportsToSol(stats && stats.earned_lamports_7d);
  const earned24hSol = lamportsToSol(stats && stats.earned_lamports_24h);
  const referees = (stats && stats.referees) || 0;
  const active = (stats && stats.active_referees) || 0;
  const splitPct = useMemo(() => {
    const bps = stats && Number(stats.split_bps_now);
    return Number.isFinite(bps) && bps > 0 ? Math.round(bps / 100) : 50;
  }, [stats]);
  const boostActive = !!(stats && stats.boost_active);

  return (
    <div className="rfp-root">
      <div className="rfp-eyebrow"><span className="d" /><span>Referrals · on-chain payouts</span></div>
      <h1 className="rfp-h1">Earn <span className="it">{splitPct}% of every fee.</span><br />Paid same block.</h1>
      <p className="rfp-sub">
        Share Nexus. Every trade your line makes returns <b>{splitPct}% of the 3% fee</b> straight to your wallet — in the same Solana transaction your referee signs. No payout schedule, no claims, nothing held.
      </p>

      {!walletStr ? (
        <div className="rfp-connect">
          <h2 className="rfp-connect-h">Connect a <span className="it">main wallet.</span></h2>
          <p className="rfp-connect-s">Your link pays out on-chain, so it's built against a real wallet — one you'll still own next year, not a disposable burner.</p>
          <button className="rfp-connect-btn" onClick={() => onConnectWallet && onConnectWallet()}>Connect wallet →</button>
          <div className="rfp-connect-foot">No email · No signup · Your keys</div>
        </div>
      ) : (
        <>
          <div className="rfp-card feature">
            <div className="rfp-card-eye"><span>◌</span><span>Your link</span></div>
            <div className="rfp-link">
              <input className="rfp-link-v" value={link} readOnly onClick={(e) => e.target.select()} />
              <button className={'rfp-link-cp' + (copied ? ' copied' : '')} onClick={copyLink}>{copied ? '✓ COPIED' : 'COPY'}</button>
            </div>
            <div className="rfp-share-row">
              <button className="rfp-sh tw" onClick={() => openTwitterShare(inviteTweet, link)}><span className="ico"><IconX /></span><span>Share on X</span></button>
              <button className="rfp-sh tg" onClick={() => openTelegram(inviteTweet, link)}><span className="ico"><IconTg /></span><span>Telegram</span></button>
              <button className={'rfp-sh ds' + (dcDone ? ' done' : '')} onClick={shareDiscord}><span className="ico"><IconDs /></span><span>{dcDone ? 'Copied ✓' : 'Copy for Discord'}</span></button>
            </div>
          </div>

          {statsError ? (
            <div className="rfp-card"><div className="rfp-empty"><span className="gl">⊘</span><div className="h">Couldn't read your stats</div><div className="e">{statsError}</div></div></div>
          ) : statsLoading && !stats ? (
            <div className="rfp-card"><div className="rfp-empty"><span className="gl">⏳</span><div className="h"><span className="rfp-spin" />Reading the ledger…</div></div></div>
          ) : (
            <div className="rfp-stats">
              <div className="rfp-stat"><div className="rfp-stat-l"><span className="gl">№</span>Referees</div><div className="rfp-stat-v">{referees}</div><div className="rfp-stat-m">{active} have traded at least once</div></div>
              <div className="rfp-stat"><div className="rfp-stat-l"><span className="gl">◉</span>24h</div><div className={'rfp-stat-v ' + (earned24hSol > 0 ? 'gn' : 'it')}>{earned24hSol > 0 ? formatSolSigned(earned24hSol) : '—'}{earned24hSol > 0 ? <span className="u">SOL</span> : null}</div><div className="rfp-stat-m">Earned, last day</div></div>
              <div className="rfp-stat"><div className="rfp-stat-l"><span className="gl">◉</span>7d</div><div className={'rfp-stat-v ' + (earned7dSol > 0 ? 'gn' : 'it')}>{earned7dSol > 0 ? formatSolSigned(earned7dSol) : '—'}{earned7dSol > 0 ? <span className="u">SOL</span> : null}</div><div className="rfp-stat-m">Earned, rolling week</div></div>
              <div className="rfp-stat"><div className="rfp-stat-l"><span className="gl">§</span>All time</div><div className={'rfp-stat-v ' + (earnedSol > 0 ? 'gn' : 'it')}>{earnedSol > 0 ? formatSolSigned(earnedSol) : '—'}{earnedSol > 0 ? <span className="u">SOL</span> : null}</div><div className="rfp-stat-m">Since your first referee</div></div>
            </div>
          )}

          <div className="rfp-card">
            <div className="rfp-card-eye"><span>⚡</span><span>Boost code</span></div>
            <p className="rfp-boost-sub">Got a KOL code? Activate it for a bigger cut of every fee your line generates, for 60 days.</p>
            <div className="rfp-boost-row">
              <input className="rfp-boost-in" placeholder="ENTER CODE" value={boostInput}
                onChange={(e) => { setBoostInput(e.target.value); setBoostMsg(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') activateBoost(); }} maxLength={32} />
              <button className="rfp-boost-btn" onClick={activateBoost} disabled={boostBusy || !boostInput.trim()}>{boostBusy ? 'Activating…' : 'Activate'}</button>
            </div>
            {boostMsg ? <div className={'rfp-boost-msg ' + (boostMsg.ok ? 'ok' : 'bad')}>{boostMsg.text}</div> : null}
            {boostActive ? <div className="rfp-boost-live"><span>●</span><span>Boost active · {splitPct}% split</span></div> : null}
          </div>

          <HowItWorks />
        </>
      )}

      {!walletStr ? <HowItWorks /> : null}

      <Standings walletStr={walletStr} lb={lb} lbLoading={lbLoading} lbError={lbError} win={lbWin} setWin={setLbWin} />
    </div>
  );
}
