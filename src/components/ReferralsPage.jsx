// WhyNexus.jsx — positioning page at /why
//
// "Three things we'll never do." — anonymity, on-chain payouts, stocks on Solana.
// Honest comparison vs "Others" (no competitors named — describes patterns, not
// brands; safer legally, and avoids reading petty).
//
// Wonderland-light pastel design to match the rest of the app.

import React, { useEffect } from 'react';

const WN_CSS = `

@keyframes wn-pulse {0%,100%{opacity:1}50%{opacity:.35}}
@keyframes wn-rise {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}

.wn-root{max-width:720px;margin:0 auto;padding:24px 18px 90px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",system-ui,sans-serif;color:#0b0b0c;background:#ffffff;-webkit-font-smoothing:antialiased}
.wn-root *{box-sizing:border-box}
.wn-root [class*="num"]{font-variant-numeric:tabular-nums}

.wn-eyebrow{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#86868b;background:#f4f4f5;padding:6px 12px;border-radius:999px}
.wn-eyebrow .d{width:5px;height:5px;border-radius:50%;background:#16c08a;animation:wn-pulse 1.4s infinite}

.wn-h1{font-family:inherit;font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.04;margin:16px 0 12px;color:#0b0b0c}
.wn-h1 .it{font-style:normal;color:#86868b}
.wn-lead{font-size:15px;line-height:1.55;color:#86868b;font-weight:500;margin:0}
.wn-lead .it{font-style:normal;color:#0b0b0c;font-weight:600}
.wn-lead b{color:#0b0b0c;font-weight:700}

.wn-trust{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}
.wn-trust .item{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:11px;font-weight:700;color:#86868b;background:#f4f4f5;padding:6px 11px;border-radius:999px}
.wn-trust .glyph{color:#11b87f;font-weight:800}
.wn-trust .dot{display:none}

.wn-divider{display:flex;align-items:center;gap:12px;margin:28px 0 16px}
.wn-divider .rule{flex:1;height:1px;background:#f1f1f2}
.wn-divider .label{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#aeaeb2}

.wn-reasons{display:flex;flex-direction:column}
.wn-reason{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid #f1f1f2;animation:wn-rise .4s cubic-bezier(.2,1,.3,1) backwards}
.wn-reason:last-child{border-bottom:none}
.wn-reason.r1{animation-delay:.04s}.wn-reason.r2{animation-delay:.1s}.wn-reason.r3{animation-delay:.16s}
.wn-reason-num{flex-shrink:0;width:30px;height:30px;border-radius:9px;background:#0b0b0c;color:#fff;display:grid;place-items:center;font-family:inherit;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}
.wn-reason-body{flex:1;min-width:0}
.wn-reason-eye{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#11b87f}
.wn-reason-h{font-family:inherit;font-size:18px;font-weight:700;letter-spacing:-.015em;margin:5px 0 6px;color:#0b0b0c}
.wn-reason-h .it{font-style:normal;color:#86868b}
.wn-reason-b{font-size:13px;line-height:1.5;color:#86868b;font-weight:500;margin:0}
.wn-reason-b b{color:#0b0b0c;font-weight:700}

.wn-compare{border:1px solid #f1f1f2;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(11,11,12,.04)}
.wn-compare-head{display:grid;grid-template-columns:1fr 60px 60px;align-items:center;padding:12px 16px;background:#fafafa;border-bottom:1px solid #f1f1f2;font-family:inherit;font-size:11px;font-weight:800}
.wn-compare-head .us{text-align:center;color:#0b0b0c}
.wn-compare-head .them{text-align:center;color:#aeaeb2}
.wn-compare-row{display:grid;grid-template-columns:1fr 60px 60px;align-items:center;padding:12px 16px;border-bottom:1px solid #f1f1f2}
.wn-compare-row:last-child{border-bottom:none}
.wn-compare-row .label{font-family:inherit;font-size:13px;font-weight:700;color:#0b0b0c}
.wn-compare-row .sub{font-size:10.5px;font-weight:500;color:#aeaeb2;margin-top:2px}
.wn-cell{justify-self:center;min-width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-family:inherit;font-size:13px;font-weight:800}
.wn-cell.yes{background:rgba(22,192,138,.14);color:#11b87f}
.wn-cell.no{background:#f4f4f5;color:#aeaeb2}
.wn-cell.maybe{background:rgba(166,114,0,.12);color:#a67200;font-size:8.5px;padding:0 8px;border-radius:999px;letter-spacing:.04em;text-transform:uppercase}

.wn-honest{border:1px solid #f1f1f2;border-radius:16px;padding:16px;background:#fafafa;margin-top:6px}
.wn-honest-eye{font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#a67200}
.wn-honest-h{font-family:inherit;font-size:18px;font-weight:700;letter-spacing:-.015em;margin:5px 0 8px;color:#0b0b0c}
.wn-honest-h .it{font-style:normal;color:#86868b}
.wn-honest-b{font-size:12.5px;line-height:1.55;color:#86868b;font-weight:500;margin:0}
.wn-honest-b b{color:#0b0b0c;font-weight:700}
.wn-honest-b .it{font-style:normal;color:#0b0b0c;font-weight:600}

.wn-cta-wrap{text-align:center;margin-top:26px;padding:26px 18px;border-radius:18px;background:#0b0b0c}
.wn-cta-h{font-family:inherit;font-size:23px;font-weight:800;letter-spacing:-.02em;color:#fff;margin:0}
.wn-cta-h .it{font-style:normal;color:rgba(255,255,255,.6)}
.wn-cta-s{font-size:12.5px;color:rgba(255,255,255,.6);font-weight:500;margin:8px 0 16px}
.wn-cta-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;color:#0b0b0c;border:none;border-radius:999px;padding:14px 26px;font-family:inherit;font-size:15px;font-weight:800;letter-spacing:-.005em;cursor:pointer;transition:opacity .14s}
.wn-cta-btn:hover{opacity:.9}
.wn-cta-btn .arrow{font-weight:800}
.wn-cta-foot{font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.45);margin-top:12px;font-variant-numeric:tabular-nums}
`;

function useWnCSS() {
  useEffect(() => {
    const id = 'why-nexus-css';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id; el.textContent = WN_CSS;
    document.head.appendChild(el);
  }, []);
}

export default function WhyNexus({ onSwitchTab }) {
  useWnCSS();
  const goSwap = () => { if (onSwitchTab) onSwitchTab('swap'); };

  return (
    <div className="wn-root">

      <div className="wn-eyebrow"><span className="d" /><span>WHY NEXUS · POSITIONING</span></div>

      <h1 className="wn-h1">Three things we'll<br /><span className="it">never do.</span></h1>

      <p className="wn-lead">
        Most "non-custodial" Solana terminals quietly add the things crypto was built to avoid — email signup, KYC creep, custodial wallets, payouts on someone else's schedule. <b>We never will.</b> Here's what that means in practice.
      </p>

      <div className="wn-trust">
        <span className="item"><span className="glyph">●</span><span>No email</span></span>
        <span className="dot">·</span>
        <span className="item"><span className="glyph">●</span><span>No KYC, ever</span></span>
        <span className="dot">·</span>
        <span className="item"><span className="glyph">●</span><span>Your keys, your funds</span></span>
      </div>

      <div className="wn-divider"><span className="rule" /><span className="label">The three rules</span><span className="rule" /></div>

      <div className="wn-reasons">
        <div className="wn-reason r1">
          <div className="wn-reason-num">01</div>
          <div className="wn-reason-body">
            <div className="wn-reason-eye">Anonymity</div>
            <h3 className="wn-reason-h">You don't sign up. <span className="it">You connect.</span></h3>
            <p className="wn-reason-b">
              Other terminals ask for an email at minimum. Some ask for a phone. A few ask for ID once you cross a volume threshold. <b>Nexus asks for nothing.</b> Connect a wallet, trade. That's the entire onboarding. The same way crypto worked in 2017 before everyone forgot.
            </p>
          </div>
        </div>

        <div className="wn-reason r2">
          <div className="wn-reason-num">02</div>
          <div className="wn-reason-body">
            <div className="wn-reason-eye">Real on-chain payouts</div>
            <h3 className="wn-reason-h">Referrals settle <span className="it">same block.</span></h3>
            <p className="wn-reason-b">
              Most referral programs send you a spreadsheet at the end of the month, then a tx whenever they get around to it. Ours is part of the trade itself — <b>50% of every fee is included in the same Solana transaction your referee signs.</b> By the time you see the notification, the SOL is already in your wallet. There's no payout schedule because there's no server holding the money.
            </p>
          </div>
        </div>

        <div className="wn-reason r3">
          <div className="wn-reason-num">03</div>
          <div className="wn-reason-body">
            <div className="wn-reason-eye">Stocks on Solana</div>
            <h3 className="wn-reason-h">Trade Tesla. <span className="it">No broker.</span></h3>
            <p className="wn-reason-b">
              TSLAx, AAPLx, NVDAx, METAx — tokenized stocks settling in USDC, 24/7, on Solana. No brokerage account, no market hours, no PDT rule. Just the connect-and-trade flow you'd use for any memecoin, applied to <b>the actual S&amp;P.</b> Nobody else on Solana has built this properly.
            </p>
          </div>
        </div>
      </div>

      <div className="wn-divider"><span className="rule" /><span className="label">Side by side</span><span className="rule" /></div>

      <div className="wn-compare">
        <div className="wn-compare-head">
          <span>What you get</span>
          <span className="us">Nexus</span>
          <span className="them">Others</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">Trade without an email</div>
            <div className="sub">Connect wallet, that's it</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell no">✗</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">No KYC at any volume</div>
            <div className="sub">No passport, no selfie, no ID</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell maybe">creeps in</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">Referrals paid same block</div>
            <div className="sub">On-chain, not "next payout"</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell no">✗</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">50% of every fee to referrers</div>
            <div className="sub">Industry standard is 20–35%</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell no">✗</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">Tokenized stocks, 24/7</div>
            <div className="sub">TSLAx, AAPLx, NVDAx in USDC</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell no">✗</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">Burner wallet, 2-second trades</div>
            <div className="sub">No extension popup hell</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell maybe">some</span>
        </div>
        <div className="wn-compare-row">
          <div>
            <div className="label">Bridge 71 chains in one app</div>
            <div className="sub">Via Chainflip, native cross-chain</div>
          </div>
          <span className="wn-cell yes">✓</span>
          <span className="wn-cell no">✗</span>
        </div>
      </div>

      <div className="wn-honest">
        <div className="wn-honest-eye">Honestly</div>
        <h3 className="wn-honest-h">What we <span className="it">aren't.</span></h3>
        <p className="wn-honest-b">
          We're new. We don't have the volume the established terminals have. We don't have their marketing budget. <b>One person built this</b> — in public, on Solana, with no investors pushing for compliance creep. What we have is the right design choices made early and an SEO + on-chain settlement moat that compounds. We're not asking you to switch overnight. We're asking you to <span className="it">try one trade</span> and see how the difference feels.
        </p>
      </div>

      <div className="wn-cta-wrap">
        <h3 className="wn-cta-h">One trade. <span className="it">No signup.</span></h3>
        <p className="wn-cta-s">Costs nothing to look. Costs less than $1 in fees to test a real swap.</p>
        <button className="wn-cta-btn" onClick={goSwap}>
          Open Nexus <span className="arrow">→</span>
        </button>
        <div className="wn-cta-foot">swap.verixiaapps.com</div>
      </div>

    </div>
  );
}
 