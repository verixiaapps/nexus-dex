import React, { useState } from 'react';

/**
 * BuySolana — provider directory ("Buy Solana").
 *
 * No embed, no KYB, no keys, no signup on our side. Each card links out to the
 * provider's own buy page (new tab); the user is THAT provider's customer and
 * does the provider's (light) KYC there. We're a signpost, not the seller.
 *
 * Order per request: MoonPay, Transak, then ChangeNOW, Changelly, Ramp. No Coinbase.
 * Logos load from Clearbit's logo-by-domain service with a branded monogram
 * fallback, so a card never shows a broken image. To pin guaranteed-official
 * assets, drop a provider's press-kit SVG URL into `logo` below.
 *
 * Buy URLs are official landing pages; tweak any in PROVIDERS if you want a
 * deeper-linked variant.
 */

const PROVIDERS = [
  {
    id: 'moonpay',
    name: 'MoonPay',
    domain: 'moonpay.com',
    url: 'https://www.moonpay.com/buy/sol',
    color: '#7D00FF',
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
    color: '#1A6CFF',
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
    color: '#00C26F',
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
    color: '#10C5A8',
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
    color: '#2E6BE6',
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

      <header className="bsp-head">
        <span className="bsp-eyebrow">Buy Solana</span>
        <h1 className="bsp-title">Get SOL with cash</h1>
        <p className="bsp-sub">
          Pick a trusted provider below to buy SOL with a card or bank transfer. You buy
          directly from them — it opens in a new tab, and your SOL goes to your own wallet.
          Lightest verification is listed first to last by how little they ask.
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
              <span className="bsp-go" aria-hidden="true">→</span>
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
  --bsp-ink: #15131f;
  --bsp-ink-soft: #5d5872;
  --bsp-line: #ece9f4;
  --bsp-card: #ffffff;
  --bsp-bg: #faf9fe;
  --bsp-violet-ink: #5a3ff0;
  max-width: 600px;
  margin: 0 auto;
  padding: 28px 18px 56px;
  color: var(--bsp-ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.bsp-head { margin-bottom: 20px; }
.bsp-eyebrow {
  display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--bsp-violet-ink); margin-bottom: 8px;
}
.bsp-title { font-size: clamp(26px, 6vw, 34px); line-height: 1.1; font-weight: 700; margin: 0 0 10px; letter-spacing: -0.02em; }
.bsp-sub { font-size: 15px; line-height: 1.55; color: var(--bsp-ink-soft); margin: 0; max-width: 52ch; }

.bsp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }

.bsp-card {
  display: flex; align-items: flex-start; gap: 14px;
  background: var(--bsp-card); border: 1px solid var(--bsp-line); border-radius: 16px;
  padding: 16px; text-decoration: none; color: inherit;
  box-shadow: 0 1px 2px rgba(21, 19, 31, 0.04);
  transition: transform 0.12s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.bsp-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(21, 19, 31, 0.10);
  border-color: var(--accent);
}
.bsp-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.bsp-logo {
  flex: 0 0 auto; width: 48px; height: 48px; border-radius: 12px;
  background: var(--bsp-bg); border: 1px solid var(--bsp-line);
  display: grid; place-items: center; overflow: hidden;
}
.bsp-logo img { width: 30px; height: 30px; object-fit: contain; display: block; }
.bsp-logo--mono { color: #fff; font-size: 20px; font-weight: 800; border: none; }

.bsp-body { flex: 1 1 auto; min-width: 0; }
.bsp-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
.bsp-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.bsp-kyc {
  flex: 0 0 auto; font-size: 11px; font-weight: 600; color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, #fff);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, #fff);
  padding: 3px 9px; border-radius: 999px; white-space: nowrap;
}
.bsp-what { font-size: 13.5px; line-height: 1.5; color: var(--bsp-ink-soft); margin: 0 0 8px; }
.bsp-pay { font-size: 12px; color: #9a96ab; margin: 0; }

.bsp-go {
  flex: 0 0 auto; align-self: center; font-size: 20px; color: var(--accent);
  transition: transform 0.12s ease;
}
.bsp-card:hover .bsp-go { transform: translateX(3px); }

.bsp-foot { margin-top: 20px; }
.bsp-foot p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--bsp-ink-soft); }

@media (max-width: 420px) {
  .bsp-root { padding: 22px 14px 48px; }
  .bsp-kyc { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .bsp-card, .bsp-go { transition: none; }
  .bsp-card:hover { transform: none; }
}
`;
