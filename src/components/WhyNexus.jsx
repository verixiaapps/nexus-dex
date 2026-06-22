// WhyNexus.jsx — positioning page at /why
//
// "Three things we'll never do." — anonymity, on-chain payouts, stocks on Solana.
// Honest comparison vs "Others" (no competitors named — describes patterns, not
// brands; safer legally, and avoids reading petty).
//
// Wonderland-light pastel design to match the rest of the app.

import React, { useEffect } from 'react';

const C = {
  ink:    '#1A1B4E',
  ink2:   'rgba(26,27,78,0.7)',
  ink3:   'rgba(26,27,78,0.45)',
  ink4:   'rgba(26,27,78,0.22)',
  cyan:   '#3DD4F5',
  sky:    '#A0E7FF',
  pink:   '#FF8FBE',
  lav:    '#B794F6',
  mint:   '#7FFFD4',
  gold:   '#FFD46B',
  green:  '#0a7a4c',
  red:    '#D14B6A',
  hairline:    'rgba(26,27,78,0.08)',
  glass:       'rgba(255,255,255,0.65)',
  glassStrong: 'rgba(255,255,255,0.85)',
  border:      'rgba(61,212,245,0.20)',
};

const WN_CSS = `
@keyframes wn-pulse {0%,100%{opacity:1}50%{opacity:.4}}
@keyframes wn-shimmer {0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes wn-cta-glow {0%,100%{box-shadow:0 12px 32px rgba(255,143,190,.40),0 0 0 1px rgba(255,143,190,.32)}50%{box-shadow:0 14px 38px rgba(160,231,255,.48),0 0 0 1px rgba(160,231,255,.42)}}
@keyframes wn-rise {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}

.wn-root { max-width: 860px; margin: 0 auto; padding: 32px 18px 80px; font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif; color: ${C.ink}; }

.wn-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: ${C.cyan};
  padding: 6px 12px; border-radius: 999px;
  background: rgba(61,212,245,.10); border: 1px solid ${C.border};
  margin-bottom: 24px;
}
.wn-eyebrow .d {
  width: 5px; height: 5px; border-radius: 50%;
  background: ${C.cyan}; box-shadow: 0 0 8px ${C.cyan};
  animation: wn-pulse 1.6s infinite;
}

.wn-h1 {
  font-family: 'Instrument Serif', serif; font-weight: 400;
  font-size: clamp(46px, 8vw, 76px); line-height: .95; letter-spacing: -.025em;
  color: ${C.ink}; margin: 0 0 18px;
}
.wn-h1 .it {
  font-style: italic;
  background: linear-gradient(120deg, ${C.sky} 0%, ${C.lav} 50%, ${C.pink} 100%);
  background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: wn-shimmer 9s linear infinite;
}

.wn-lead {
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(16px, 2.4vw, 19px); font-weight: 500; line-height: 1.55;
  color: ${C.ink2}; margin: 0 0 14px; max-width: 640px;
}
.wn-lead b { color: ${C.ink}; font-weight: 700; }
.wn-lead .it { font-style: italic; font-family: 'Instrument Serif', serif; font-weight: 400; }

.wn-trust {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 22px 0 0;
  font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700;
  color: ${C.ink3}; letter-spacing: .06em;
}
.wn-trust .item { display: inline-flex; align-items: center; gap: 5px; }
.wn-trust .glyph { color: ${C.green}; font-size: 12px; }
.wn-trust .dot { opacity: .5; }

.wn-divider {
  margin: 56px 0 28px;
  display: flex; align-items: center; gap: 12px;
}
.wn-divider .rule { flex: 1; height: 1px; background: ${C.hairline}; }
.wn-divider .label {
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: ${C.ink3};
}

.wn-reasons { display: flex; flex-direction: column; gap: 16px; }
.wn-reason {
  position: relative; overflow: hidden;
  padding: 28px; border-radius: 24px;
  background: ${C.glassStrong}; backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.85);
  display: grid; grid-template-columns: 80px 1fr; gap: 24px; align-items: center;
  animation: wn-rise .5s cubic-bezier(.2,1,.3,1) backwards;
}
.wn-reason:nth-child(1){animation-delay:.05s}
.wn-reason:nth-child(2){animation-delay:.10s}
.wn-reason:nth-child(3){animation-delay:.15s}
.wn-reason::before {
  content:''; position: absolute; top: -40%; right: -10%;
  width: 50%; height: 180%;
  background: radial-gradient(closest-side, var(--rsn-glow, rgba(61,212,245,.16)), transparent);
  pointer-events: none;
}
.wn-reason-num {
  position: relative; z-index: 1;
  font-family: 'Instrument Serif', serif; font-weight: 400; font-style: italic;
  font-size: 72px; line-height: 1; letter-spacing: -.03em;
  color: var(--rsn-acc, ${C.cyan});
}
.wn-reason-body { position: relative; z-index: 1; }
.wn-reason-eye {
  font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 800;
  letter-spacing: .16em; text-transform: uppercase; color: var(--rsn-acc, ${C.cyan});
  margin-bottom: 8px;
}
.wn-reason-h {
  font-family: 'Instrument Serif', serif; font-weight: 400;
  font-size: clamp(22px, 3.4vw, 28px); line-height: 1.15; letter-spacing: -.02em;
  color: ${C.ink}; margin: 0 0 10px;
}
.wn-reason-h .it { font-style: italic; color: var(--rsn-acc, ${C.cyan}); }
.wn-reason-b {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14.5px; line-height: 1.6; color: ${C.ink2}; margin: 0;
}
.wn-reason-b b { color: ${C.ink}; font-weight: 700; }
.wn-reason.r1 { --rsn-acc: ${C.pink}; --rsn-glow: rgba(255,143,190,.20); }
.wn-reason.r2 { --rsn-acc: ${C.cyan}; --rsn-glow: rgba(61,212,245,.18); }
.wn-reason.r3 { --rsn-acc: ${C.green}; --rsn-glow: rgba(127,255,212,.22); }

@media(max-width:600px) {
  .wn-reason { grid-template-columns: 1fr; gap: 12px; padding: 22px; }
  .wn-reason-num { font-size: 48px; }
}

.wn-compare {
  margin-top: 24px;
  background: ${C.glassStrong}; backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.85);
  border-radius: 24px; overflow: hidden;
}
.wn-compare-head {
  display: grid; grid-template-columns: 1.4fr 100px 100px;
  gap: 8px; padding: 18px 22px;
  background: linear-gradient(135deg, rgba(160,231,255,.16), rgba(255,143,190,.12));
  border-bottom: 1px solid ${C.hairline};
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 800;
  letter-spacing: .14em; text-transform: uppercase; color: ${C.ink2};
}
.wn-compare-head .us { color: ${C.ink}; text-align: center; }
.wn-compare-head .them { color: ${C.ink3}; text-align: center; }
.wn-compare-row {
  display: grid; grid-template-columns: 1.4fr 100px 100px;
  gap: 8px; padding: 14px 22px; align-items: center;
  border-bottom: 1px solid ${C.hairline};
}
.wn-compare-row:last-child { border-bottom: none; }
.wn-compare-row .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px; font-weight: 600; color: ${C.ink};
}
.wn-compare-row .sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px; font-weight: 600; color: ${C.ink3};
  margin-top: 2px; letter-spacing: .02em;
}
.wn-cell {
  text-align: center;
  font-family: 'Instrument Serif', serif; font-weight: 400; font-style: italic;
  font-size: 22px; letter-spacing: -.01em;
}
.wn-cell.yes { color: ${C.green}; }
.wn-cell.no { color: ${C.red}; }
.wn-cell.maybe { color: ${C.ink3}; font-size: 13px; font-style: normal;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }

@media(max-width:560px){
  .wn-compare-head, .wn-compare-row {
    grid-template-columns: 1fr 70px 70px;
    padding: 12px 14px;
  }
  .wn-compare-row .label { font-size: 13px; }
  .wn-cell { font-size: 19px; }
}

.wn-honest {
  margin-top: 18px;
  padding: 28px; border-radius: 24px;
  background: linear-gradient(135deg, rgba(183,148,246,.14), rgba(160,231,255,.10));
  border: 1px solid rgba(183,148,246,.32);
}
.wn-honest-eye {
  font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 800;
  letter-spacing: .16em; text-transform: uppercase; color: ${C.lav};
  margin-bottom: 10px;
}
.wn-honest-h {
  font-family: 'Instrument Serif', serif; font-weight: 400;
  font-size: clamp(22px, 3.4vw, 28px); line-height: 1.15; letter-spacing: -.02em;
  color: ${C.ink}; margin: 0 0 12px;
}
.wn-honest-h .it { font-style: italic; color: ${C.lav}; }
.wn-honest-b {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14.5px; line-height: 1.65; color: ${C.ink2}; margin: 0;
}
.wn-honest-b b { color: ${C.ink}; font-weight: 700; }
.wn-honest-b .it { font-style: italic; font-family: 'Instrument Serif', serif; font-weight: 400; }

.wn-cta-wrap {
  margin-top: 40px; padding: 36px 24px;
  text-align: center;
  background: ${C.glass};
  border: 1px solid ${C.border};
  border-radius: 24px;
}
.wn-cta-h {
  font-family: 'Instrument Serif', serif; font-weight: 400;
  font-size: clamp(26px, 4vw, 34px); line-height: 1.1; letter-spacing: -.02em;
  color: ${C.ink}; margin: 0 0 8px;
}
.wn-cta-h .it { font-style: italic;
  background: linear-gradient(120deg, ${C.sky}, ${C.pink});
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.wn-cta-s {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px; color: ${C.ink2}; margin: 0 0 22px;
}
.wn-cta-btn {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 16px 26px; border: none; cursor: pointer;
  border-radius: 14px;
  background: linear-gradient(135deg, ${C.sky}, ${C.pink});
  color: ${C.ink}; font-family: 'Space Grotesk', sans-serif;
  font-weight: 700; font-size: 15px;
  animation: wn-cta-glow 3.6s ease-in-out infinite;
}
.wn-cta-btn .arrow { font-family: 'JetBrains Mono', monospace; font-weight: 800; font-size: 14px; }
.wn-cta-foot {
  margin-top: 14px;
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
  color: ${C.ink3}; letter-spacing: .08em; text-transform: uppercase;
}
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
 