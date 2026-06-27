import React, { useState } from 'react';

/**
 * BuySolana — provider directory ("Buy Solana"), dark DeFi-native theme.
 *
 * No embed, no KYB, no keys, no signup on our side. Each card links out to the
 * provider's own buy page (new tab); the user is THAT provider's customer and
 * does the provider's (light) KYC there. We're a signpost, not the seller.
 *
 * Order per request: MoonPay, Transak, then ChangeNOW, Changelly, Ramp. No Coinbase.
 * Logos load from Clearbit's logo-by-domain service onto a light chip (so dark
 * provider marks stay legible) with a branded monogram fallback, so a card never
 * shows a broken image. To pin guaranteed-official assets, drop a provider's
 * press-kit SVG URL into `logo` below.
 */

const PROVIDERS = [
  {
    id: 'moonpay',
    name: 'MoonPay',
    domain: 'moonpay.com',
    url: 'https://www.moonpay.com/buy/sol',
    color: '#9D5BFF',
    kyc: 'Phone + email to start',
    what:
      "The most widely used consumer on-ramp — it's what Phantom uses. Buy SOL with a card, Apple or Google Pay, PayPal, or bank, and it lands in your wallet. The quickest path for first-timers.",
    pay: 'Card · Apple/Google Pay · PayPal · bank · min $20',
  },
  {
    id: 'transak',
    name: 'Transak',
    domain: 'transak.com',
    url: 'https://transak.com/buy-crypto',
    color: '#4D8DFF',
    kyc: 'Light tier for small amounts',
    what:
      'A global on-ramp with the widest local payment options — bank rails like SEPA, ACH, UPI, and PIX alongside cards. A good pick if cards are awkward in your country.',
    pay: 'Card · SEPA · ACH · UPI · PIX · SEPA ~1%',
  },
  {
    id: 'changenow',
    name: 'ChangeNOW',
    domain: 'changenow.io',
    url: 'https://changenow.io/buy/sol',
    color: '#19E08A',
    kyc: 'No account',
    what:
      'Non-custodial and account-free — you pay and SOL goes straight to your wallet. The lightest verification of the bunch; it only asks for ID if a transaction gets flagged.',
    pay: 'Card or crypto · sent to your wallet',
  },
  {
    id: 'changelly',
    name: 'Changelly',
    domain: 'changelly.com',
    url: 'https://changelly.com/buy/sol',
    color: '#22D6BC',
    kyc: 'No account',
    what:
      'No account needed. It compares several payment providers, routes you to the best rate, then hands off to pay. Handy when you want the cheapest available quote.',
    pay: 'Card · best-rate routing',
  },
  {
    id: 'ramp',
    name: 'Ramp Network',
    domain: 'ramp.network',
    url: 'https://ramp.network/buy',
    color: '#5B86FF',
    kyc: 'Light ID',
    what:
      'Buys SOL direct to your own wallet with notably cheap bank-transfer fees and a smooth open-banking flow in Europe. Good when you want low fees over speed.',
    pay: 'Bank ~1.4% · card ~3.9%',
  },
];

function monogram(name) {
  return name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase();
}

function ProviderLogo({ p }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="bsp-logo bsp-logo--mono" style={{ background: p.color }}>
        {monogram(p.name)}
      </span>
    );
  }
  return (
    <span className="bsp-logo">
      <img
        src={`https://logo.clearbit.com/${p.domain}?size=96`}
        alt={`${p.name} logo`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export default function BuySolana() {
  return (
    <div className="bsp-root">
      <style>{bspStyles}</style>

      <div className="bsp-glow" aria-hidden="true" />

      <header className="bsp-head">
        <span className="bsp-eyebrow">Buy Solana</span>
        <h1 className="bsp-title">Get SOL with cash</h1>
        <span className="bsp-rule" aria-hidden="true" />
        <p className="bsp-sub">
          Pick a trusted provider to buy SOL with a card or bank transfer. You buy directly
          from them — it opens in a new tab, and your SOL goes to your own wallet. Listed
          lightest-verification first, by how little they ask.
        </p>
      </header>

      <ul className="bsp-list">
        {PROVIDERS.map((p) => (
          <li key={p.id}>
            <a
              className="bsp-card"
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buy Solana with ${p.name} (opens in a new tab)`}
              style={{ '--accent': p.color }}
            >
              <ProviderLogo p={p} />
              <div className="bsp-body">
                <div className="bsp-row">
                  <span className="bsp-name">{p.name}</span>
                  <span className="bsp-kyc">{p.kyc}</span>
                </div>
                <p className="bsp-what">{p.what}</p>
                <p className="bsp-pay">{p.pay}</p>
              </div>
              <span className="bsp-go" aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>

      <footer className="bsp-foot">
        <p>
          These are independent providers, not us — you complete the purchase and any identity
          check on their site, and they set their own fees, limits, and supported regions.
          Always double-check your wallet address before paying.
        </p>
      </footer>
    </div>
  );
}

const bspStyles = `
.bsp-root {
  --bsp-bg: #08060f;
  --bsp-panel: #0f0b1c;
  --bsp-card: rgba(255, 255, 255, 0.035);
  --bsp-card-hover: rgba(255, 255, 255, 0.055);
  --bsp-line: rgba(255, 255, 255, 0.08);
  --bsp-ink: #f1eefb;
  --bsp-ink-soft: #9a93b4;
  --bsp-ink-faint: #645d7e;
  --bsp-purple: #9945ff;
  --bsp-mint: #14f195;
  position: relative;
  max-width: 600px;
  margin: 0 auto;
  padding: 36px 18px 56px;
  color: var(--bsp-ink);
  background:
    radial-gradient(120% 60% at 50% -10%, rgba(153, 69, 255, 0.16), transparent 60%),
    var(--bsp-bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
.bsp-mono {
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace;
}

.bsp-glow {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(40% 30% at 88% 8%, rgba(20, 241, 149, 0.10), transparent 70%);
}

.bsp-head, .bsp-list, .bsp-foot { position: relative; z-index: 1; }

.bsp-head { margin-bottom: 24px; }
.bsp-eyebrow {
  display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; margin-bottom: 12px;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace;
  background: linear-gradient(90deg, var(--bsp-purple), var(--bsp-mint));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.bsp-title {
  font-size: clamp(28px, 7vw, 38px); line-height: 1.05; font-weight: 700;
  margin: 0 0 14px; letter-spacing: -0.025em;
}
.bsp-rule {
  display: block; width: 56px; height: 3px; border-radius: 2px; margin: 0 0 16px;
  background: linear-gradient(90deg, var(--bsp-purple), var(--bsp-mint));
}
.bsp-sub { font-size: 15px; line-height: 1.6; color: var(--bsp-ink-soft); margin: 0; max-width: 52ch; }

.bsp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }

.bsp-card {
  position: relative; display: flex; align-items: flex-start; gap: 14px;
  background: var(--bsp-card); border: 1px solid var(--bsp-line); border-radius: 16px;
  padding: 16px; text-decoration: none; color: inherit;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  transition: transform 0.14s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.bsp-card:hover {
  transform: translateY(-2px);
  background: var(--bsp-card-hover);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow:
    0 12px 30px rgba(0, 0, 0, 0.45),
    0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent),
    0 8px 40px color-mix(in srgb, var(--accent) 22%, transparent);
}
.bsp-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.bsp-logo {
  flex: 0 0 auto; width: 48px; height: 48px; border-radius: 12px;
  background: #f6f5fb; border: 1px solid var(--bsp-line);
  display: grid; place-items: center; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5);
}
.bsp-logo img { width: 30px; height: 30px; object-fit: contain; display: block; }
.bsp-logo--mono { color: #fff; font-size: 20px; font-weight: 800; border: none; background: var(--accent); }

.bsp-body { flex: 1 1 auto; min-width: 0; }
.bsp-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.bsp-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--bsp-ink); }
.bsp-kyc {
  flex: 0 0 auto; font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--accent) 78%, #fff);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  padding: 3px 9px; border-radius: 999px; white-space: nowrap;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace;
}
.bsp-what { font-size: 13.5px; line-height: 1.55; color: var(--bsp-ink-soft); margin: 0 0 9px; }
.bsp-pay {
  font-size: 11.5px; color: var(--bsp-ink-faint); margin: 0; letter-spacing: 0.01em;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace;
}

.bsp-go {
  flex: 0 0 auto; align-self: center; font-size: 18px; line-height: 1;
  color: var(--bsp-ink-faint);
  transition: transform 0.14s ease, color 0.18s ease;
}
.bsp-card:hover .bsp-go { transform: translate(2px, -2px); color: var(--accent); }

.bsp-foot { margin-top: 22px; }
.bsp-foot p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--bsp-ink-faint); }

@media (max-width: 420px) {
  .bsp-root { padding: 28px 14px 48px; }
  .bsp-kyc { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .bsp-card, .bsp-go { transition: none; }
  .bsp-card:hover { transform: none; }
  .bsp-card:hover .bsp-go { transform: none; }
}
`;
