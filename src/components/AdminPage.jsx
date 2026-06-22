// AdminPage.jsx — Nexus DEX admin dashboard.
//
// Gated to ADMIN_WALLETS (see App.js). Fetches /api/admin/overview and renders
// a single-page dashboard of visits, trades, revenue, and referrals. No menu
// link — reach it at /admin only. The endpoint itself also wallet-gates, so
// even if someone guesses the URL they get a 403.

import React, { useState, useEffect, useCallback, useRef } from 'react';

const C = {
  ink:  '#1A1B4E',
  ink2: 'rgba(26,27,78,0.7)',
  ink3: 'rgba(26,27,78,0.45)',
  cyan: '#3DD4F5',
  pink: '#FF8FBE',
  lav:  '#B794F6',
  gold: '#FFD46B',
  green:'#0a7a4c',
  red:  '#D14B6A',
  glass:'rgba(255,255,255,0.85)',
  hair: 'rgba(26,27,78,0.08)',
};

const ADM_CSS = `
.adm-root{font-family:'Space Grotesk',-apple-system,system-ui,sans-serif;color:${C.ink};max-width:1100px;margin:0 auto;padding:28px 18px 64px;-webkit-font-smoothing:antialiased}
.adm-h{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:6px}
.adm-h h1{font-family:'Instrument Serif',serif;font-style:italic;font-size:42px;letter-spacing:-.02em;margin:0;line-height:1}
.adm-h .ts{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${C.ink3};font-weight:700;letter-spacing:.08em}
.adm-sub{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${C.ink2};margin-bottom:24px;font-weight:600}
.adm-sub b{color:${C.green}}
.adm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:22px}
.adm-card{background:${C.glass};border:1px solid rgba(255,255,255,0.85);border-radius:18px;padding:18px;box-shadow:0 4px 16px rgba(26,27,78,0.04)}
.adm-card .lbl{font-family:'JetBrains Mono',monospace;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.ink3};margin-bottom:8px}
.adm-card .val{font-family:'Instrument Serif',serif;font-size:34px;letter-spacing:-.01em;line-height:1;color:${C.ink}}
.adm-card .val .u{font-family:'Space Grotesk',sans-serif;font-size:14px;color:${C.ink3};font-weight:600;margin-left:5px}
.adm-card .sub{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:${C.ink2};margin-top:10px;font-weight:700;letter-spacing:.04em}
.adm-card.accent{background:linear-gradient(135deg,rgba(160,231,255,0.30),rgba(255,143,190,0.20));border:1px solid rgba(61,212,245,0.30)}
.adm-card.accent .val{font-style:italic;color:${C.ink}}
.adm-section{background:${C.glass};border:1px solid rgba(255,255,255,0.85);border-radius:18px;padding:20px 22px;margin-bottom:18px;box-shadow:0 4px 16px rgba(26,27,78,0.04)}
.adm-section h2{font-family:'Instrument Serif',serif;font-style:italic;font-size:24px;letter-spacing:-.01em;margin:0 0 14px;color:${C.ink}}
.adm-section h2 .pill{font-family:'JetBrains Mono',monospace;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.12em;color:${C.ink3};background:rgba(26,27,78,0.06);padding:3px 9px;border-radius:999px;margin-left:8px;vertical-align:middle;text-transform:uppercase}
.adm-table{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:12px}
.adm-table th{text-align:left;font-weight:700;color:${C.ink3};font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid ${C.hair}}
.adm-table th.r{text-align:right}
.adm-table td{padding:9px 8px;border-bottom:1px solid ${C.hair};color:${C.ink};font-weight:600}
.adm-table td.r{text-align:right}
.adm-table tr:hover td{background:rgba(255,255,255,0.55)}
.adm-table td.wal{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:-.005em}
.adm-table td.wal .copy{cursor:pointer;color:${C.cyan};margin-left:6px;font-weight:800;font-size:9.5px}
.adm-spark{display:flex;align-items:flex-end;gap:3px;height:60px;margin-top:6px}
.adm-spark .b{flex:1;background:linear-gradient(180deg,${C.cyan},${C.pink});border-radius:3px 3px 0 0;min-height:2px;transition:height .2s}
.adm-spark .b.zero{background:rgba(26,27,78,0.06)}
.adm-axis{display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:9px;color:${C.ink3};font-weight:700;margin-top:6px;letter-spacing:.04em}
.adm-empty{padding:32px 0;text-align:center;color:${C.ink3};font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.adm-locked{max-width:520px;margin:0 auto;padding:80px 16px;text-align:center}
.adm-locked .lk{font-size:48px;margin-bottom:18px}
.adm-locked h1{font-family:'Instrument Serif',serif;font-size:32px;font-style:italic;color:${C.ink};margin:0 0 10px;letter-spacing:-.015em}
.adm-locked p{color:${C.ink2};font-size:14px;font-weight:500;line-height:1.5}
.adm-locked button{margin-top:18px;padding:13px 22px;border-radius:14px;border:none;cursor:pointer;background:linear-gradient(135deg,${C.cyan},${C.pink});color:#fff;font-weight:700;font-size:14px;font-family:'Space Grotesk',sans-serif;letter-spacing:.02em;box-shadow:0 6px 16px rgba(61,212,245,0.32)}
.adm-loading{text-align:center;padding:80px 0;color:${C.ink3};font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.adm-note{background:linear-gradient(135deg,rgba(255,212,107,0.18),rgba(255,176,136,0.12));border:1px solid rgba(255,212,107,0.32);color:#7a5400;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.02em;padding:12px 16px;border-radius:12px;margin-bottom:22px;line-height:1.5}
.adm-foot{text-align:center;color:${C.ink3};font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;margin-top:28px}
.adm-refresh{padding:8px 14px;border-radius:10px;border:1px solid rgba(26,27,78,0.14);background:rgba(255,255,255,0.65);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.1em;color:${C.ink};cursor:pointer}
.adm-refresh:hover{background:rgba(255,255,255,0.95)}
.adm-refresh.busy{opacity:0.5;cursor:wait}
.adm-tab-row{display:flex;gap:6px;margin-bottom:14px}
.adm-tab{padding:6px 12px;border-radius:8px;border:1px solid ${C.hair};background:transparent;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;letter-spacing:.1em;color:${C.ink3};cursor:pointer;text-transform:uppercase}
.adm-tab.on{background:${C.ink};color:#fff;border-color:${C.ink}}
@media(max-width:600px){.adm-h h1{font-size:32px}.adm-card .val{font-size:26px}.adm-section{padding:16px 14px}.adm-section h2{font-size:20px}.adm-table th,.adm-table td{padding:6px 4px;font-size:10.5px}}
`;

function useCSS() {
  useEffect(() => {
    const id = 'adm-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = ADM_CSS;
    document.head.appendChild(el);
  }, []);
}

function trunc(w) { return w ? w.slice(0, 4) + '…' + w.slice(-4) : '—'; }
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtSol(lamports) { return ((Number(lamports) || 0) / 1e9).toFixed(3); }
function fmtSolShort(n) {
  const x = Number(n) || 0;
  if (x >= 1000) return (x / 1000).toFixed(1) + 'K';
  if (x >= 1)    return x.toFixed(2);
  return x.toFixed(3);
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy" onClick={(e) => {
      e.stopPropagation();
      try {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch (e) {}
    }}>{copied ? 'OK' : 'COPY'}</span>
  );
}

function StatCard({ label, value, unit, sub, accent }) {
  return (
    <div className={'adm-card' + (accent ? ' accent' : '')}>
      <div className="lbl">{label}</div>
      <div className="val">{value}{unit ? <span className="u">{unit}</span> : null}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function Sparkline({ data, accessor, height }) {
  if (!data || data.length === 0) return <div className="adm-empty">No data</div>;
  const values = data.map(accessor);
  const max = Math.max(1, ...values);
  return (
    <div className="adm-spark" style={{ height: (height || 60) + 'px' }}>
      {values.map((v, i) => (
        <div key={i} className={'b' + (v === 0 ? ' zero' : '')} style={{ height: ((v / max) * 100) + '%' }} title={data[i].day + ': ' + fmt(v)} />
      ))}
    </div>
  );
}

function HourlyBars({ hourly }) {
  if (!hourly || hourly.length === 0) return <div className="adm-empty">No trades in last 24h</div>;
  const max = Math.max(0.001, ...hourly);
  return (
    <>
      <div className="adm-spark" style={{ height: '60px' }}>
        {hourly.map((v, i) => (
          <div key={i} className={'b' + (v === 0 ? ' zero' : '')} style={{ height: ((v / max) * 100) + '%' }} title={(23 - i) + 'h ago: ' + v.toFixed(3) + ' SOL'} />
        ))}
      </div>
      <div className="adm-axis"><span>24h ago</span><span>now</span></div>
    </>
  );
}

export default function AdminPage({ onConnectWallet, walletAddress, isConnected, onSwitchTab }) {
  useCSS();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async (isManual) => {
    if (!walletAddress || inFlight.current) return;
    inFlight.current = true;
    if (isManual) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch('/api/admin/overview?wallet=' + encodeURIComponent(walletAddress));
      if (r.status === 403) { setForbidden(true); setData(null); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setData(d); setErr(null); setForbidden(false);
    } catch (e) {
      setErr(String(e.message || 'Failed'));
    } finally {
      inFlight.current = false;
      setLoading(false); setRefreshing(false);
    }
  }, [walletAddress]);

  useEffect(() => { if (walletAddress) load(false); }, [walletAddress, load]);
  useEffect(() => {
    if (!walletAddress) return;
    const id = setInterval(() => load(false), 60_000);
    return () => clearInterval(id);
  }, [walletAddress, load]);

  if (!isConnected || !walletAddress) {
    return (
      <div className="adm-root">
        <div className="adm-locked">
          <div className="lk">🔒</div>
          <h1>Admin only</h1>
          <p>Connect the admin wallet to view this dashboard. There's nothing public here.</p>
          <button onClick={onConnectWallet}>Connect wallet</button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="adm-root">
        <div className="adm-locked">
          <div className="lk">⊘</div>
          <h1>Not authorized</h1>
          <p>This dashboard is locked to specific wallets. Switch to the admin wallet, or head back home.</p>
          {onSwitchTab ? <button onClick={() => onSwitchTab('swap')}>Back to swap</button> : null}
        </div>
      </div>
    );
  }

  if (loading && !data) return <div className="adm-root"><div className="adm-loading">LOADING DASHBOARD…</div></div>;
  if (err && !data)     return <div className="adm-root"><div className="adm-loading">ERROR: {err}</div></div>;
  if (!data)            return <div className="adm-root"><div className="adm-loading">NO DATA</div></div>;

  const { visits, trades, revenue, referrals } = data;
  const ts = new Date(data.ts);

  return (
    <div className="adm-root">
      <div className="adm-h">
        <h1>Admin · <span style={{ fontStyle: 'normal', color: C.cyan }}>signal</span></h1>
        <button className={'adm-refresh' + (refreshing ? ' busy' : '')} onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? 'REFRESHING…' : '↻ REFRESH'}
        </button>
      </div>
      <div className="adm-sub">
        Updated {ts.toLocaleTimeString()} · auto-refresh every 60s · gated to your wallet
      </div>

      <div className="adm-note">
        Heads up: trades shown here are <b>Ape activity only</b>. Swap, Bridge, Markets and Wonderland aren't yet instrumented — their volume lives on-chain at the fee wallet. Visits cover the whole site.
      </div>

      {/* ── VISITS ─────────────────────────────────────────── */}
      <div className="adm-section">
        <h2>Site visits <span className="pill">whole site</span></h2>
        <div className="adm-grid">
          <StatCard accent label="Total visits"      value={fmt(visits.total)} />
          <StatCard       label="Unique visitors"    value={fmt(visits.uniques_total)} sub="all time" />
          <StatCard       label="Uniques · 24h"      value={fmt(visits.uniques_24h)} />
          <StatCard       label="Uniques · 7d"       value={fmt(visits.uniques_7d)} />
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="lbl" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: C.ink3, marginBottom: 8 }}>Daily visits · last 30d</div>
          <Sparkline data={visits.last30} accessor={d => d.count} />
          <div className="adm-axis"><span>30d ago</span><span>today</span></div>
        </div>
      </div>

      {/* ── TOP PATHS ─────────────────────────────────────── */}
      <div className="adm-section">
        <h2>Where they land</h2>
        {visits.top_paths.length === 0 ? (
          <div className="adm-empty">No path data yet</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Path</th><th className="r">Visits</th></tr></thead>
            <tbody>
              {visits.top_paths.map(p => (
                <tr key={p.path}><td>{p.path}</td><td className="r">{fmt(p.count)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── REFERRAL VISITS ──────────────────────────────── */}
      {visits.top_refs_by_visits.length > 0 ? (
        <div className="adm-section">
          <h2>Top referrers by clicks <span className="pill">?ref=… visits</span></h2>
          <table className="adm-table">
            <thead><tr><th>Referrer wallet</th><th className="r">Visits</th></tr></thead>
            <tbody>
              {visits.top_refs_by_visits.map(r => (
                <tr key={r.wallet}>
                  <td className="wal">{trunc(r.wallet)} <CopyBtn text={r.wallet} /></td>
                  <td className="r">{fmt(r.visits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ── TRADES ───────────────────────────────────────── */}
      <div className="adm-section">
        <h2>Trades <span className="pill">ape only</span></h2>
        <div className="adm-grid">
          <StatCard accent label="Volume · 24h"   value={fmtSolShort(trades.volume_sol_24h)} unit="SOL" sub={fmt(trades.trades_24h) + ' trades'} />
          <StatCard       label="Volume · 7d"    value={fmtSolShort(trades.volume_sol_7d)}  unit="SOL" sub={fmt(trades.trades_7d) + ' trades'} />
          <StatCard       label="Volume · all"   value={fmtSolShort(trades.volume_sol_all)} unit="SOL" sub={fmt(trades.total) + ' trades'} />
          <StatCard       label="Traders · 24h"  value={fmt(trades.unique_traders_24h)} sub={fmt(trades.unique_traders_7d) + ' last 7d · ' + fmt(trades.unique_traders_all) + ' ever'} />
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="lbl" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: C.ink3, marginBottom: 8 }}>Hourly Ape volume · last 24h</div>
          <HourlyBars hourly={trades.hourly_volume_24h} />
        </div>
      </div>

      {/* ── REVENUE ──────────────────────────────────────── */}
      <div className="adm-section">
        <h2>Your platform earnings <span className="pill">net of referrer share</span></h2>
        <div className="adm-grid">
          <StatCard accent label="Kept · all time"  value={fmtSol(revenue.platform_kept_lamports_all)} unit="SOL" sub="net to your fee wallet" />
          <StatCard       label="Kept · 24h"        value={fmtSol(revenue.platform_kept_lamports_24h)} unit="SOL" />
          <StatCard       label="Kept · 7d"         value={fmtSol(revenue.platform_kept_lamports_7d)}  unit="SOL" />
          <StatCard       label="Paid to referrers" value={fmtSol(revenue.referrer_paid_lamports_all)} unit="SOL" sub="growth investment · all time" />
        </div>
      </div>

      {/* ── REFERRAL SIGN-UPS ───────────────────────────── */}
      <div className="adm-section">
        <h2>Referral sign-ups</h2>
        <div className="adm-grid">
          <StatCard accent label="Total referees" value={fmt(referrals.referees_total)} sub="locked to a referrer" />
          <StatCard       label="New · 24h"       value={fmt(referrals.referees_24h)} />
          <StatCard       label="New · 7d"        value={fmt(referrals.referees_7d)} />
        </div>
      </div>

      {/* ── TOP REFERRERS BY EARNINGS ─────────────────── */}
      <div className="adm-section">
        <h2>Top referrers <span className="pill">by SOL earned</span></h2>
        {referrals.top_referrers.length === 0 ? (
          <div className="adm-empty">No referral earnings yet</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Wallet</th><th className="r">Referees</th><th className="r">Earned</th></tr></thead>
            <tbody>
              {referrals.top_referrers.map(r => (
                <tr key={r.wallet}>
                  <td className="wal">{trunc(r.wallet)} <CopyBtn text={r.wallet} /></td>
                  <td className="r">{fmt(r.active_referees)}</td>
                  <td className="r">{fmtSol(r.earned_lamports)} SOL</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── TOP TRADERS BY VOLUME ─────────────────────── */}
      <div className="adm-section">
        <h2>Top Ape traders <span className="pill">by volume</span></h2>
        {trades.top_traders.length === 0 ? (
          <div className="adm-empty">No trades yet</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Wallet</th><th className="r">Trades</th><th className="r">Volume</th></tr></thead>
            <tbody>
              {trades.top_traders.map(t => (
                <tr key={t.wallet}>
                  <td className="wal">{trunc(t.wallet)} <CopyBtn text={t.wallet} /></td>
                  <td className="r">{fmt(t.trades)}</td>
                  <td className="r">{fmtSolShort(t.volume_sol)} SOL</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="adm-foot">Nexus DEX admin · {ts.toUTCString()}</div>
    </div>
  );
}
 