/* ========================================================================
 * SEO Pages Router
 *
 * Usage in server.js (ONE line, BEFORE express.static):
 *
 *     app.use(require('./seo-pages'));
 *
 * Serves:
 *   /nexus-dex/defi/:pair      — SEO swap pages (sol-to-usdc, etc.)
 *   /nexus-dex/defi            — index of all pairs
 *   /solana-web3.iife.min.js   — web3 lib from node_modules
 *   /seo-sitemap.xml           — sitemap for crawlers
 * ===================================================================== */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

/* ─── SOLANA WEB3.JS from node_modules ────────────────────────────── */
const WEB3_CANDIDATES = [
  path.join(__dirname, 'node_modules', '@solana', 'web3.js', 'lib', 'index.iife.min.js'),
  path.join(__dirname, 'node_modules', '@solana', 'web3.js', 'lib', 'index.iife.js'),
];
const WEB3_PATH = WEB3_CANDIDATES.find(p => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (WEB3_PATH) {
  router.get('/solana-web3.iife.min.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(WEB3_PATH);
  });
  console.log('[seo-pages] Serving solana-web3.js from node_modules');
} else {
  console.warn('[seo-pages] solana-web3.js not in node_modules — falling back to unpkg CDN');
}

/* ─── TEMPLATE ────────────────────────────────────────────────────── */
const TEMPLATE_PATH = path.join(__dirname, 'template', 'defi-template.html');
let _tpl = null;

function getTemplate() {
  if (_tpl && process.env.NODE_ENV === 'production') return _tpl;
  try { _tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8'); }
  catch (e) { console.error('[seo-pages] Cannot read template:', e.message); _tpl = null; }
  return _tpl;
}

/* ─── RPC CONFIG — injected inline so the swap widget gets the Helius URL ── */
function getRpcUrl() {
  if (process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC)
    return process.env.HELIUS_RPC_URL || process.env.REACT_APP_SOLANA_RPC;
  if (process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY)
    return 'https://mainnet.helius-rpc.com/?api-key=' +
      encodeURIComponent(process.env.HELIUS_API_KEY || process.env.REACT_APP_HELIUS_API_KEY);
  return 'https://api.mainnet-beta.solana.com';
}

function buildConfigScript() {
  const cfg = {
    rpc: getRpcUrl(),
    wcProjectId: process.env.WALLETCONNECT_PROJECT_ID
              || process.env.REACT_APP_WALLETCONNECT_PROJECT_ID
              || '',
  };
  return '<script>window.__VERIXIA_CONFIG__=' + JSON.stringify(cfg) + ';</script>';
}

/* ─── TOKEN REGISTRY ──────────────────────────────────────────────── */
const TOKENS = {
  SOL:     { mint: 'So11111111111111111111111111111111111111112',  symbol: 'SOL',     name: 'Solana' },
  USDC:    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC',   name: 'USD Coin' },
  USDT:    { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  symbol: 'USDT',   name: 'Tether USD' },
  BONK:    { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK',   name: 'Bonk' },
  JUP:     { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  symbol: 'JUP',    name: 'Jupiter' },
  WIF:     { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF',    name: 'dogwifhat' },
  RAY:     { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY',    name: 'Raydium' },
  PYTH:    { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH',   name: 'Pyth Network' },
  JTO:     { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  symbol: 'JTO',    name: 'Jito' },
  RNDR:    { mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  symbol: 'RNDR',   name: 'Render' },
  HNT:     { mint: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  symbol: 'HNT',    name: 'Helium' },
  ORCA:    { mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  symbol: 'ORCA',   name: 'Orca' },
  MSOL:    { mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  symbol: 'mSOL',   name: 'Marinade SOL' },
  JITOSOL: { mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', symbol: 'JitoSOL', name: 'Jito Staked SOL' },
  SAMO:    { mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', symbol: 'SAMO',   name: 'Samoyedcoin' },
};

const tk = (sym) => TOKENS[sym.toUpperCase()] || null;
const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const SITE = 'https://verixiaapps.com';

/* ─── SEO DATA BUILDER ────────────────────────────────────────────── */
function buildPairData(fromSym, toSym) {
  const from = tk(fromSym), to = tk(toSym);
  if (!from || !to) return null;
  const slug      = `${fromSym.toLowerCase()}-to-${toSym.toLowerCase()}`;
  const canonical = `${SITE}/nexus-dex/defi/${slug}`;
  const now       = new Date().toISOString().split('T')[0];

  return {
    slug, inputMint: from.mint, outputMint: to.mint,
    TITLE:          `Swap ${from.symbol} to ${to.symbol} — Verixia | No KYC · Instant`,
    DESCRIPTION:    `Swap ${from.symbol} to ${to.symbol} instantly on Verixia. No KYC, no accounts, no limits. Powered by Jupiter.`,
    KEYWORD:        `${from.symbol} to ${to.symbol}, swap ${from.symbol}, Solana DEX, no KYC, Jupiter, Verixia`,
    CANONICAL_URL:  canonical,
    OG_IMAGE:       `${SITE}/og/${slug}.png`,
    MODIFIED_DATE:  now,
    BREADCRUMB_NAME: `Swap ${from.symbol} → ${to.symbol}`,
    STATIC_INTRO:   `${from.symbol} → ${to.symbol} · LIVE ON SOLANA`,
    STATIC_H1:      `<span class="line2">${from.symbol}</span> <span class="arr">→</span> ${to.symbol}`,
    SUPP_HEADING:   `About this pair`,
    SUPP_INTRO:     `${from.symbol} <span class="grad">→ ${to.symbol}</span>`,
    AGGREGATE_RATING_JSON: JSON.stringify({"@type":"AggregateRating","ratingValue":"4.8","ratingCount":"1240","bestRating":"5"}),
    AI_CONTENT: `<div style="color:var(--text-dim);font-size:13px;line-height:1.7;">
      <p style="margin-bottom:12px;">Swap <b style="color:var(--text)">${esc(from.symbol)}</b> to <b style="color:var(--text)">${esc(to.symbol)}</b> instantly on Verixia. Connect your Solana wallet, enter an amount, and swap — no sign-ups, no KYC, no limits.</p>
      <p style="margin-bottom:12px;">Verixia routes through <b style="color:#00b8d4">Jupiter</b>, Solana's leading DEX aggregator, scanning every on-chain liquidity source for the best rate. Sub-second settlement.</p>
      <p>Works with Phantom, Solflare, Backpack, and WalletConnect-compatible wallets.</p></div>`,
    RELATED_LINKS: [
      { q:`How do I swap ${from.symbol} to ${to.symbol}?`, a:`Connect your Solana wallet, enter the amount of ${from.symbol}, and tap Swap. ${to.symbol} arrives in under a second.` },
      { q:`Do I need an account?`, a:`No. Verixia is non-custodial. Just connect your wallet and swap. No sign-ups, no KYC.` },
      { q:`What are the fees?`, a:`3% platform fee per swap. Solana network fees are fractions of a cent.` },
      { q:`Is it safe?`, a:`Fully non-custodial. Your tokens never leave your wallet until the swap executes on-chain via Jupiter's audited contracts.` },
      { q:`What wallets work?`, a:`Phantom, Solflare, Backpack, and any WalletConnect-compatible Solana wallet.` },
    ].map(f=>`<div class="faq-item"><div class="faq-q"><span>${esc(f.q)}</span><span class="plus">+</span></div><div class="faq-a">${esc(f.a)}</div></div>`).join(''),
    SCHEMA_FAQ: JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
      {"@type":"Question","name":`How do I swap ${from.symbol} to ${to.symbol}?`,"acceptedAnswer":{"@type":"Answer","text":`Connect your Solana wallet, enter the amount, tap Swap. No account needed.`}},
      {"@type":"Question","name":"Do I need KYC?","acceptedAnswer":{"@type":"Answer","text":"No. No KYC, no accounts, no limits."}},
      {"@type":"Question","name":"What are the fees?","acceptedAnswer":{"@type":"Answer","text":"3% platform fee. Solana network fees are fractions of a cent."}},
    ]}),
    HUB_LINK: `More <span class="grad">swaps</span>`,
    MORE_LINKS: buildRelatedTiles(from, to),
    PAGE_META_SCRIPT: `<script>document.getElementById('verixia-swap-root').setAttribute('data-input-mint','${from.mint}');document.getElementById('verixia-swap-root').setAttribute('data-output-mint','${to.mint}');</script>`,
  };
}

function buildRelatedTiles(from, to) {
  const ALL = [['SOL','USDC'],['SOL','USDT'],['SOL','BONK'],['SOL','JUP'],['SOL','WIF'],['SOL','RAY'],['USDC','BONK'],['USDC','JUP'],['SOL','PYTH'],['SOL','JTO'],['SOL','ORCA'],['SOL','MSOL']];
  return ALL.filter(([a,b])=>`${a}-${b}`!==`${from.symbol}-${to.symbol}`).slice(0,4).map(([a,b])=>
    `<a href="/nexus-dex/defi/${a.toLowerCase()}-to-${b.toLowerCase()}" class="pair-tile" style="text-decoration:none;color:inherit;"><div class="from-to">${a} <span class="arr">→</span> ${b}</div><div class="rate">Swap instantly</div><div class="change">No KYC</div></a>`
  ).join('');
}

/* ─── RENDER ──────────────────────────────────────────────────────── */
function renderPage(data) {
  let html = getTemplate();
  if (!html) return null;
  // Inject RPC config before </head>
  html = html.replace('</head>', buildConfigScript() + '\n</head>');
  // Fill placeholders
  for (const [key, val] of Object.entries(data)) {
    if (key === 'slug' || key === 'inputMint' || key === 'outputMint') continue;
    html = html.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), String(val));
  }
  html = html.replace(/\{\{[A-Z_]+\}\}/g, '');
  return html;
}

/* ─── ROUTES ──────────────────────────────────────────────────────── */

router.get('/nexus-dex/defi/:pair', (req, res) => {
  const m = (req.params.pair||'').match(/^([a-z0-9]+)-to-([a-z0-9]+)$/i);
  if (!m) return res.status(404).json({ error: 'Invalid pair. Use /nexus-dex/defi/sol-to-usdc' });
  const data = buildPairData(m[1], m[2]);
  if (!data) return res.status(404).json({ error: 'Unknown token. Supported: ' + Object.keys(TOKENS).join(', ') });
  const html = renderPage(data);
  if (!html) return res.status(500).json({ error: 'Template not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(html);
});

router.get('/nexus-dex/defi', (req, res) => {
  const ALL = [['SOL','USDC'],['SOL','USDT'],['SOL','BONK'],['SOL','JUP'],['SOL','WIF'],['SOL','RAY'],['SOL','PYTH'],['SOL','JTO'],['SOL','ORCA'],['SOL','MSOL'],['SOL','JITOSOL'],['USDC','BONK'],['USDC','JUP'],['USDC','WIF']];
  const grid = ALL.map(([a,b])=>`<a href="/nexus-dex/defi/${a.toLowerCase()}-to-${b.toLowerCase()}" class="pair-tile" style="text-decoration:none;color:inherit;"><div class="from-to">${a} <span class="arr">→</span> ${b}</div><div class="rate">Swap instantly</div><div class="change">No KYC</div></a>`).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Swap Any Solana Token — Verixia | No KYC</title><meta name="description" content="Swap any Solana token instantly. No KYC, no limits. Powered by Jupiter."><link rel="canonical" href="${SITE}/nexus-dex/defi"><link href="https://fonts.googleapis.com/css2?family=Zen+Dots&family=Outfit:wght@400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet"><style>:root{--bg:#020106;--line:rgba(120,80,220,.12);--text:#e8e0f5;--text-dim:#9b8fc0;--text-faint:#564670;--cyan:#00b8d4;--magenta:#c4359a;--green:#3dd494;}*{box-sizing:border-box;margin:0;padding:0;}body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh;padding:20px;background:radial-gradient(circle 500px at 20% 8%,rgba(0,184,212,.12),transparent 60%),radial-gradient(circle 700px at 90% 28%,rgba(196,53,154,.12),transparent 60%),var(--bg);}h1{font-family:'Zen Dots';font-size:24px;text-transform:uppercase;text-align:center;margin:40px 0 10px;}h1 .grad{background:linear-gradient(90deg,var(--cyan),var(--magenta));-webkit-background-clip:text;background-clip:text;color:transparent;}.sub{text-align:center;color:var(--text-dim);font-size:14px;margin-bottom:30px;font-family:'JetBrains Mono';letter-spacing:.08em;text-transform:uppercase;}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:420px;margin:0 auto;}.pair-tile{background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:16px;padding:14px;position:relative;overflow:hidden;}.pair-tile::before{content:'';position:absolute;top:-20px;right:-20px;width:60px;height:60px;background:var(--cyan);border-radius:50%;filter:blur(20px);opacity:.25;}.pair-tile:nth-child(even)::before{background:var(--magenta);}.from-to{font-family:'Outfit';font-weight:800;font-size:15px;display:flex;align-items:center;gap:5px;position:relative;z-index:1;}.arr{color:var(--magenta);}.rate{font-family:'JetBrains Mono';font-size:11px;color:var(--text-faint);margin-top:4px;position:relative;z-index:1;}.change{font-family:'JetBrains Mono';font-size:10px;color:var(--green);font-weight:700;margin-top:2px;position:relative;z-index:1;}</style></head><body><h1>Swap <span class="grad">Any</span> Token</h1><p class="sub">No KYC · No Limits · Powered by Jupiter</p><div class="grid">${grid}</div></body></html>`);
});

router.get('/seo-sitemap.xml', (req, res) => {
  const ALL = [['SOL','USDC'],['SOL','USDT'],['SOL','BONK'],['SOL','JUP'],['SOL','WIF'],['SOL','RAY'],['SOL','PYTH'],['SOL','JTO'],['SOL','ORCA'],['SOL','MSOL'],['SOL','JITOSOL'],['USDC','BONK'],['USDC','JUP'],['USDC','WIF']];
  const now = new Date().toISOString().split('T')[0];
  const urls = [`  <url><loc>${SITE}/nexus-dex/defi</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  for (const [a,b] of ALL) urls.push(`  <url><loc>${SITE}/nexus-dex/defi/${a.toLowerCase()}-to-${b.toLowerCase()}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
});

module.exports = router;
