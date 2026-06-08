<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>{{TITLE}}</title>
<meta name="description" content="{{DESCRIPTION}}">
<meta name="keywords" content="{{KEYWORD}}">
<link rel="canonical" href="{{CANONICAL_URL}}">

<meta property="og:type" content="website">
<meta property="og:url" content="{{CANONICAL_URL}}">
<meta property="og:title" content="{{TITLE}}">
<meta property="og:description" content="{{DESCRIPTION}}">
<meta property="og:image" content="{{OG_IMAGE}}">
<meta property="og:site_name" content="Verixia">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{TITLE}}">
<meta name="twitter:description" content="{{DESCRIPTION}}">
<meta name="twitter:image" content="{{OG_IMAGE}}">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "url": "{{CANONICAL_URL}}",
  "name": "{{TITLE}}",
  "description": "{{DESCRIPTION}}",
  "dateModified": "{{MODIFIED_DATE}}",
  "aggregateRating": {{AGGREGATE_RATING_JSON}},
  "isPartOf": { "@type": "WebSite", "url": "https://verixiaapps.com/", "name": "Verixia" },
  "publisher": { "@type": "Organization", "name": "Verixia", "url": "https://verixiaapps.com/" }
}
</script>

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Verixia", "item": "https://verixiaapps.com/" },
    { "@type": "ListItem", "position": 2, "name": "{{BREADCRUMB_NAME}}", "item": "{{CANONICAL_URL}}" }
  ]
}
</script>

<script type="application/ld+json">
{{SCHEMA_FAQ}}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Dots&family=Outfit:wght@400;500;600;700;800;900&family=Caveat:wght@500;700&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #020106;
    --bg-2: #060210;
    --card: #0a0420;
    --card-2: #0e0628;
    --line: rgba(120, 80, 220, 0.12);
    --line-2: rgba(0, 180, 210, 0.28);
    --text: #e8e0f5;
    --text-dim: #9b8fc0;
    --text-faint: #564670;
    --cyan: #00b8d4;
    --magenta: #c4359a;
    --violet: #7a3dd4;
    --gold: #d4a533;
    --green: #3dd494;
    --pink: #c66aa8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { background: var(--bg); color: var(--text); font-family: 'Outfit', sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
  body {
    min-height: 100vh;
    background:
      radial-gradient(circle 500px at 20% 8%, rgba(0, 184, 212, 0.12), transparent 60%),
      radial-gradient(circle 700px at 90% 28%, rgba(196, 53, 154, 0.12), transparent 60%),
      radial-gradient(circle 500px at 30% 60%, rgba(122, 61, 212, 0.10), transparent 60%),
      radial-gradient(circle 500px at 80% 90%, rgba(0, 184, 212, 0.07), transparent 60%),
      var(--bg);
  }
  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 20% 30%, white, transparent),
      radial-gradient(1px 1px at 70% 10%, white, transparent),
      radial-gradient(1.5px 1.5px at 40% 70%, var(--cyan), transparent),
      radial-gradient(1px 1px at 90% 60%, white, transparent),
      radial-gradient(1.5px 1.5px at 10% 90%, var(--pink), transparent),
      radial-gradient(1px 1px at 60% 40%, white, transparent),
      radial-gradient(1px 1px at 30% 50%, white, transparent),
      radial-gradient(1.5px 1.5px at 80% 80%, var(--magenta), transparent),
      radial-gradient(1px 1px at 50% 20%, white, transparent),
      radial-gradient(1px 1px at 15% 60%, white, transparent);
    background-size: 350px 350px;
    opacity: 0.5;
    pointer-events: none;
    z-index: 0;
    animation: twinkle 7s ease-in-out infinite;
  }
  @keyframes twinkle { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
  body::after {
    content: '';
    position: fixed; inset: 0;
    background-image:
      linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 62, 213, 0.05) 1px, transparent 1px);
    background-size: 60px 60px;
    transform: perspective(500px) rotateX(60deg) translateY(40%);
    transform-origin: center bottom;
    mask-image: linear-gradient(to bottom, transparent 50%, black);
    pointer-events: none;
    z-index: 0;
  }
  main { position: relative; z-index: 1; padding-bottom: 60px; }
  .marquee {
    background: linear-gradient(90deg, var(--cyan), var(--pink), var(--magenta), var(--violet), var(--cyan));
    background-size: 300% 100%;
    animation: hueshift 8s linear infinite;
    color: black;
    padding: 8px 0;
    font-family: 'Zen Dots', sans-serif;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    overflow: hidden;
    position: relative;
  }
  @keyframes hueshift { from { background-position: 0% 0%; } to { background-position: 300% 0%; } }
  .marquee-track {
    display: inline-flex;
    gap: 28px;
    white-space: nowrap;
    animation: scroll 25s linear infinite;
    padding-left: 28px;
  }
  .marquee-track span { display: inline-flex; align-items: center; gap: 8px; }
  @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    background: rgba(4, 2, 10, 0.85);
    backdrop-filter: blur(14px);
    position: sticky; top: 0; z-index: 20;
    border-bottom: 1px solid var(--line);
    gap: 8px;
  }
  .header-msg { display: none; }
  @media (min-width: 480px) {
    .header-msg { display: block; text-align: right; line-height: 1.25; flex: 1; padding: 0 8px; }
    .header-msg-l1 { font-family: 'Outfit'; font-weight: 800; font-size: 15px; color: white; letter-spacing: -0.01em; }
    .header-msg-l1 .grad { background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .header-msg-l2 { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11px; color: var(--text-dim); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 1px; }
    .header-msg-l3 { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 10px; color: var(--text-faint); letter-spacing: 0.06em; margin-top: 1px; }
    .header-msg-l3 .jup-mark { color: var(--cyan); font-size: 11px; margin-right: 2px; }
  }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-mark { width: 34px; height: 34px; background: linear-gradient(135deg, var(--cyan), var(--magenta)); color: white; display: grid; place-items: center; font-family: 'Zen Dots'; font-size: 15px; border-radius: 50% 30% 50% 30%; box-shadow: 0 0 24px rgba(0, 229, 255, 0.5), 0 0 40px rgba(255, 62, 213, 0.3); animation: morph 6s ease-in-out infinite; }
  @keyframes morph { 0%, 100% { border-radius: 50% 30% 50% 30%; } 50% { border-radius: 30% 50% 30% 50%; } }
  .logo-text { font-family: 'Zen Dots'; font-size: 14px; letter-spacing: 0.06em; background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .live-pill { display: flex; align-items: center; gap: 6px; padding: 6px 11px; background: rgba(0, 229, 255, 0.08); border: 1px solid var(--line-2); border-radius: 100px; font-family: 'JetBrains Mono'; font-size: 10px; font-weight: 700; color: var(--cyan); letter-spacing: 0.1em; }
  .live-pill .pulse { width: 6px; height: 6px; background: var(--cyan); border-radius: 50%; box-shadow: 0 0 10px var(--cyan); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.7); } }
  .connect { font-family: 'Outfit'; font-weight: 800; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; padding: 10px 18px; background: linear-gradient(90deg, var(--cyan), var(--magenta)); border: 0; color: black; border-radius: 100px; box-shadow: 0 4px 16px rgba(255, 62, 213, 0.4), inset 0 1px 0 rgba(255,255,255,0.4); cursor: pointer; }
  .hero { padding: 14px 18px 6px; position: relative; min-height: 0; }
  .hero-content { position: relative; z-index: 2; max-width: 100%; text-align: center; }
  .pair-meta { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(0,0,0,0.5); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 100px; font-family: 'JetBrains Mono'; font-size: 10px; color: var(--text-dim); letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600; margin-bottom: 16px; }
  .pair-meta .dot { width: 6px; height: 6px; background: var(--green); border-radius: 50%; box-shadow: 0 0 8px var(--green); }
  .pair-meta b { color: var(--cyan); }
  h1 { font-family: 'Zen Dots'; font-weight: 400; font-size: 26px; line-height: 1.05; letter-spacing: -0.02em; margin-bottom: 8px; text-transform: uppercase; }
  h1 .line2 { background: linear-gradient(90deg, var(--cyan) 0%, var(--magenta) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  h1 .arr { color: var(--magenta); font-family: 'Outfit'; font-weight: 900; font-style: italic; -webkit-text-fill-color: var(--magenta); margin-right: 4px; }
  .hero-msg-mobile { margin-top: 12px; text-align: center; }
  .hero-msg-mobile .l1 { font-family: 'Outfit'; font-weight: 800; font-size: 20px; color: white; letter-spacing: -0.01em; }
  .hero-msg-mobile .l1 .grad { background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero-msg-mobile .l2 { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 13px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px; }
  .hero-msg-mobile .l3 { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 11px; color: var(--text-faint); letter-spacing: 0.05em; margin-top: 2px; }
  .hero-msg-mobile .l3 .jup-mark { color: var(--cyan); margin-right: 3px; font-size: 12px; }
  @media (min-width: 480px) { .hero-msg-mobile { display: none; } }
  .tag-stack { display: flex; flex-direction: column; gap: 6px; margin: 16px 0; }
  .tag-line { display: inline-flex; align-items: center; background: rgba(0,0,0,0.6); border: 1px solid var(--line); border-radius: 4px; padding: 6px 12px; width: fit-content; font-family: 'Zen Dots'; font-size: 11px; letter-spacing: 0.08em; gap: 8px; }
  .tag-line .icon { font-size: 13px; } .tag-line .lbl { color: white; }
  .tag-line .val { background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lede { color: var(--text-dim); font-size: 13px; line-height: 1.5; max-width: 380px; font-weight: 500; margin-top: 10px; background: rgba(0,0,0,0.4); backdrop-filter: blur(6px); padding: 10px 12px; border-left: 2px solid var(--cyan); border-radius: 0 8px 8px 0; }
  .lede b { color: var(--text); font-weight: 700; }
  .signature { margin-top: 16px; position: relative; z-index: 2; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); padding: 10px 14px; border-radius: 12px; border: 1px dashed var(--line); display: inline-block; }
  .signature p { font-family: 'Caveat'; font-weight: 700; font-size: 19px; line-height: 1.1; }
  .signature p:nth-child(1) { color: white; } .signature p:nth-child(2) { color: var(--pink); } .signature p:nth-child(3) { color: var(--cyan); }
  .signature .crown { color: var(--gold); font-size: 14px; }
  .brand-strip { padding: 24px 18px 8px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; position: relative; }
  .brand-strip .tag-stack { margin: 0; flex-shrink: 0; } .brand-strip .signature { margin: 0; }
  .swap-wrap { padding: 12px 18px 10px; position: relative; margin-top: 0; }
  .swap-wrap::before { content: ''; position: absolute; top: 0; left: -20px; width: 200px; height: 200px; background: var(--cyan); border-radius: 50%; filter: blur(60px); opacity: 0.3; z-index: 0; }
  .swap-wrap::after { content: ''; position: absolute; bottom: 20px; right: -30px; width: 220px; height: 220px; background: var(--magenta); border-radius: 50%; filter: blur(60px); opacity: 0.3; z-index: 0; }
  .ticker { display: grid; grid-template-columns: repeat(4, 1fr); margin: 16px 18px 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  .ticker-cell { padding: 12px 8px; border-right: 1px solid var(--line); text-align: center; }
  .ticker-cell:last-child { border-right: 0; }
  .ticker-cell .lbl { font-family: 'JetBrains Mono'; font-size: 9px; color: var(--text-faint); letter-spacing: 0.15em; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; }
  .ticker-cell .val { font-family: 'Outfit'; font-weight: 800; font-size: 15px; }
  .ticker-cell .val.up { color: var(--green); } .ticker-cell .val.cy { color: var(--cyan); }
  .section { padding: 36px 18px 4px; position: relative; }
  .section-tag { display: inline-flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono'; font-size: 10px; background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 700; margin-bottom: 10px; }
  .section-tag::before { content: ''; width: 24px; height: 1px; background: linear-gradient(90deg, var(--cyan), var(--magenta)); }
  .section-title { font-family: 'Zen Dots'; font-weight: 400; font-size: 26px; line-height: 1.1; letter-spacing: -0.01em; margin-bottom: 20px; text-transform: uppercase; }
  .section-title .grad { background: linear-gradient(90deg, var(--cyan), var(--magenta)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .faq-item { background: rgba(255,255,255,0.02); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; margin-bottom: 8px; }
  .faq-q { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-family: 'Outfit'; font-weight: 700; font-size: 14px; }
  .faq-q .plus { width: 24px; height: 24px; background: linear-gradient(135deg, var(--cyan), var(--magenta)); color: black; border-radius: 50%; display: grid; place-items: center; font-size: 14px; font-weight: 900; flex-shrink: 0; }
  .faq-a { font-size: 13px; line-height: 1.6; color: var(--text-dim); margin-top: 8px; }
  .pair-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .pair-tile { background: rgba(255,255,255,0.02); backdrop-filter: blur(6px); border: 1px solid var(--line); border-radius: 16px; padding: 14px; position: relative; overflow: hidden; }
  .pair-tile::before { content: ''; position: absolute; top: -20px; right: -20px; width: 60px; height: 60px; background: var(--cyan); border-radius: 50%; filter: blur(20px); opacity: 0.25; }
  .pair-tile:nth-child(even)::before { background: var(--magenta); }
  .pair-tile .from-to { font-family: 'Outfit'; font-weight: 800; font-size: 15px; display: flex; align-items: center; gap: 5px; position: relative; z-index: 1; }
  .pair-tile .from-to .arr { color: var(--magenta); margin: 0 2px; }
  .pair-tile .rate { font-family: 'JetBrains Mono'; font-size: 11px; color: var(--text-faint); margin-top: 4px; position: relative; z-index: 1; }
  .pair-tile .change { font-family: 'JetBrains Mono'; font-size: 10px; color: var(--green); font-weight: 700; margin-top: 2px; position: relative; z-index: 1; }
  .pair-tile .change.dn { color: var(--magenta); }
  .hub-link-label { color: var(--text-faint); font-family: 'JetBrains Mono'; font-size: 11px; }
  .hub-link-anchor { color: var(--cyan); font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 700; text-decoration: none; }
  .hub-link-anchor:hover { text-decoration: underline; }
  footer { margin-top: 32px; padding: 28px 18px; border-top: 1px solid var(--line); text-align: center; position: relative; }
  footer::before { content: ''; position: absolute; top: -1px; left: 50%; transform: translateX(-50%); width: 60%; height: 1px; background: linear-gradient(90deg, transparent, var(--cyan), var(--magenta), transparent); }
  footer .marks { font-family: 'Caveat'; font-weight: 700; font-size: 22px; color: white; margin-bottom: 6px; }
  footer .marks .pink { color: var(--pink); } footer .marks .cy { color: var(--cyan); } footer .marks .crown { color: var(--gold); }
  footer .links { display: flex; justify-content: center; gap: 18px; margin: 14px 0 12px; font-family: 'JetBrains Mono'; font-size: 11px; color: var(--text-dim); letter-spacing: 0.1em; }
  footer .legal { font-family: 'JetBrains Mono'; font-size: 10px; color: var(--text-faint); letter-spacing: 0.05em; line-height: 1.6; }
  #verixia-swap-root { display: block; min-height: 460px; }
  .swap-skeleton { min-height: 460px; border-radius: 22px; background: radial-gradient(circle at 50% 0%, rgba(0, 184, 212, 0.14), transparent 70%), linear-gradient(180deg, var(--card), var(--card-2)); border: 1px solid var(--line-2); position: relative; overflow: hidden; margin: 0 auto; max-width: 380px; }
  .swap-skeleton::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(0, 184, 212, 0.07), transparent); background-size: 200% 100%; animation: skel 1.8s linear infinite; }
  @keyframes skel { 0% { background-position: -100% 0; } 100% { background-position: 200% 0; } }
  .swap-skeleton-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-dim); }
  .swap-skeleton-msg .skel-title { font-family: 'Zen Dots', sans-serif; font-size: 18px; letter-spacing: 0.05em; text-transform: none; background: linear-gradient(90deg, white, var(--cyan)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .swap-skeleton-msg .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 10px var(--cyan); animation: pulse 1.6s ease-in-out infinite; }
  .sw-root { --sw-cyan:#00b8d4; --sw-magenta:#c4359a; --sw-violet:#7a3dd4; --sw-green:#3dd494; --sw-pink:#c66aa8; --sw-gold:#d4a533; --sw-text:#e8e0f5; --sw-dim:#9b8fc0; --sw-faint:#564670; --sw-line:rgba(255,255,255,.08); --sw-line-2:rgba(0,180,210,.28); --sw-leg:rgba(0,0,0,.42); --sw-card:linear-gradient(180deg, rgba(16,8,40,.94), rgba(22,10,53,.94)); --sw-display:'Zen Dots', ui-sans-serif, system-ui, sans-serif; --sw-body:'Outfit', ui-sans-serif, system-ui, sans-serif; --sw-mono:'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace; position:relative; width:100%; max-width:380px; margin:0 auto; color:var(--sw-text); font-family:var(--sw-body); -webkit-font-smoothing:antialiased; text-align:left; }
  .sw-root *, .sw-root *::before, .sw-root *::after { box-sizing:border-box; }
  .sw-container { position:relative; background:var(--sw-card); backdrop-filter:blur(14px); border:1px solid var(--sw-line); border-radius:20px; padding:13px; box-shadow:0 0 0 1px rgba(0,229,255,.10), 0 14px 38px -24px rgba(255,62,213,.5), inset 0 1px 0 rgba(255,255,255,.05); }
  .sw-container::before { content:''; position:absolute; inset:-1px; border-radius:20px; padding:1px; background:conic-gradient(from 0deg, var(--sw-cyan), var(--sw-magenta), var(--sw-violet), var(--sw-cyan)); -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite:xor; mask-composite:exclude; pointer-events:none; opacity:.22; animation:sw-spin 9s linear infinite; }
  .sw-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; position:relative; z-index:1; }
  .sw-title { display:flex; align-items:center; gap:6px; font-family:var(--sw-display); font-size:10px; font-weight:400; letter-spacing:.14em; text-transform:uppercase; margin:0; color:var(--sw-dim); }
  .sw-title::before { content:'✦'; color:var(--sw-magenta); font-size:11px; }
  .sw-live-pill { display:none; }
  .sw-live-dot { width:5px; height:5px; border-radius:50%; background:var(--sw-cyan); box-shadow:0 0 8px var(--sw-cyan); animation:sw-pulse 1.4s ease-in-out infinite; }
  .sw-panel { display:flex; flex-direction:column; gap:3px; position:relative; z-index:1; }
  .sw-row { background:var(--sw-leg); border:1px solid rgba(255,255,255,.05); border-radius:13px; padding:10px 12px; transition:border-color .2s, box-shadow .2s; }
  .sw-row:focus-within { border-color:var(--sw-cyan); box-shadow:0 0 0 2px rgba(0,229,255,.13); }
  .sw-row-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }
  .sw-row-label { font-family:var(--sw-mono); font-size:9px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--sw-faint); }
  .sw-balance { display:inline-flex; align-items:center; gap:6px; font-family:var(--sw-mono); font-size:10px; color:var(--sw-faint); }
  .sw-max-btn { font-family:var(--sw-mono); font-size:9px; font-weight:700; color:var(--sw-magenta); background:rgba(196,53,154,.12); border:1px solid rgba(196,53,154,.3); border-radius:6px; padding:2px 6px; cursor:pointer; }
  .sw-max-btn:hover { background:rgba(196,53,154,.22); }
  .sw-row-mid { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .sw-amount-input { flex:1 1 auto; min-width:0; width:100%; background:transparent; border:0; outline:0; color:var(--sw-text); font-family:var(--sw-body); font-weight:700; font-size:23px; letter-spacing:-.02em; }
  .sw-amount-input::placeholder { color:var(--sw-faint); opacity:.6; }
  .sw-token-btn { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; padding:5px 10px 5px 5px; background:linear-gradient(135deg, rgba(0,229,255,.1), rgba(255,62,213,.1)); border:1px solid rgba(255,255,255,.09); border-radius:100px; color:var(--sw-text); font-family:var(--sw-body); font-weight:700; font-size:13px; white-space:nowrap; cursor:pointer; transition:border-color .15s, transform .1s; }
  .sw-token-btn:hover { border-color:rgba(0,229,255,.45); }
  .sw-token-btn svg { color:var(--sw-cyan); width:12px; height:12px; }
  .sw-token-logo { width:20px; height:20px; border-radius:50%; object-fit:cover; display:grid; place-items:center; font-size:10px; font-weight:800; color:#000; }
  .sw-flip-wrap { display:flex; justify-content:center; margin:-7px 0; position:relative; z-index:3; }
  .sw-flip-btn { width:30px; height:30px; display:grid; place-items:center; border:3px solid #0a0420; border-radius:50%; background:linear-gradient(135deg, var(--sw-cyan), var(--sw-magenta)); color:#000; cursor:pointer; box-shadow:0 4px 12px rgba(0,229,255,.4); transition:transform .4s ease; }
  .sw-flip-btn:hover { transform:rotate(180deg); }
  .sw-flip-btn svg { width:14px; height:14px; }
  .sw-details { margin-top:8px; padding:9px 12px; background:rgba(0,0,0,.32); border:1px solid var(--sw-line); border-radius:11px; position:relative; z-index:1; }
  .sw-detail-row { display:flex; align-items:center; justify-content:space-between; gap:10px; font-family:var(--sw-mono); font-size:10px; color:var(--sw-dim); padding:2px 0; }
  .sw-detail-val { color:var(--sw-text); font-weight:600; text-align:right; }
  .sw-impact-good{color:var(--sw-green);} .sw-impact-warn{color:var(--sw-gold);} .sw-impact-bad{color:#ff5d7d;} .sw-impact-neutral{color:var(--sw-dim);}
  .sw-banner { margin-top:9px; padding:9px 12px; border-radius:10px; font-size:12px; line-height:1.4; border:1px solid transparent; position:relative; z-index:1; }
  .sw-banner-error { background:rgba(255,93,125,.1); border-color:rgba(255,93,125,.35); color:#ffb3c1; }
  .sw-banner-success { background:rgba(61,212,148,.1); border-color:rgba(61,212,148,.35); color:#9ff0cc; }
  .sw-banner-pending { background:rgba(212,165,51,.1); border-color:rgba(212,165,51,.35); color:#f0d79a; }
  .sw-banner-link { color:var(--sw-cyan); font-weight:700; text-decoration:none; border-bottom:1px solid rgba(0,229,255,.4); }
  .sw-primary-btn { width:100%; margin-top:10px; padding:13px; border:0; border-radius:13px; color:#000; font-family:var(--sw-display); font-size:11px; font-weight:400; letter-spacing:.12em; text-transform:uppercase; cursor:pointer; position:relative; z-index:1; background:linear-gradient(90deg, var(--sw-cyan) 0%, var(--sw-pink) 35%, var(--sw-magenta) 70%, var(--sw-violet) 100%); background-size:250% 100%; animation:sw-hue 5s linear infinite; box-shadow:0 8px 22px -10px rgba(255,62,213,.5), inset 0 1px 0 rgba(255,255,255,.3); transition:transform .1s; }
  .sw-primary-btn:not(.sw-disabled):active { transform:translateY(1px); }
  .sw-primary-btn.sw-disabled { cursor:not-allowed; animation:none; background:rgba(255,255,255,.06); color:var(--sw-faint); box-shadow:none; border:1px solid var(--sw-line); }
  .sw-footer { margin:8px 0 0; text-align:center; font-family:var(--sw-mono); font-size:10px; color:var(--sw-faint); position:relative; z-index:1; }
  .sw-footer b { background:linear-gradient(90deg, var(--sw-cyan), var(--sw-magenta)); -webkit-background-clip:text; background-clip:text; color:transparent; font-weight:800; }
  .sw-modal-overlay { position:fixed; inset:0; z-index:9999; display:flex; align-items:flex-end; justify-content:center; background:rgba(2,1,6,.7); backdrop-filter:blur(6px); }
  @media (min-width:560px){ .sw-modal-overlay{ align-items:center; padding:20px; } }
  .sw-modal-card { width:100%; max-width:420px; max-height:80vh; display:flex; flex-direction:column; background:var(--sw-card); border:1px solid var(--sw-line-2); border-radius:20px 20px 0 0; box-shadow:0 -20px 60px -10px rgba(0,0,0,.7); overflow:hidden; }
  @media (min-width:560px){ .sw-modal-card{ border-radius:20px; } }
  .sw-modal-head { padding:14px 14px 11px; border-bottom:1px solid var(--sw-line); }
  .sw-modal-head-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:11px; }
  .sw-modal-title { font-family:var(--sw-display); font-size:11px; font-weight:400; letter-spacing:.06em; text-transform:uppercase; margin:0; }
  .sw-icon-btn { width:30px; height:30px; display:grid; place-items:center; background:rgba(255,255,255,.04); border:1px solid var(--sw-line); border-radius:9px; color:var(--sw-dim); cursor:pointer; }
  .sw-icon-btn:hover { color:var(--sw-text); border-color:var(--sw-cyan); }
  .sw-modal-search { width:100%; padding:10px 13px; background:rgba(0,0,0,.45); border:1px solid var(--sw-line); border-radius:11px; color:var(--sw-text); font-family:var(--sw-body); font-size:13px; outline:0; }
  .sw-modal-search:focus { border-color:var(--sw-cyan); box-shadow:0 0 0 2px rgba(0,229,255,.13); }
  .sw-modal-search::placeholder { color:var(--sw-faint); }
  .sw-modal-list { flex:1 1 auto; overflow-y:auto; padding:5px; }
  .sw-modal-msg { padding:22px 14px; text-align:center; font-family:var(--sw-mono); font-size:11px; color:var(--sw-faint); }
  .sw-token-row { width:100%; display:flex; align-items:center; gap:11px; padding:9px 11px; background:transparent; border:0; border-radius:11px; cursor:pointer; text-align:left; }
  .sw-token-row:hover { background:rgba(255,255,255,.04); }
  .sw-token-row-logo, .sw-token-row-placeholder { width:30px; height:30px; border-radius:50%; flex-shrink:0; object-fit:cover; }
  .sw-token-row-placeholder { background:linear-gradient(135deg, rgba(0,229,255,.25), rgba(255,62,213,.25)); }
  .sw-token-row-info { flex:1 1 auto; min-width:0; }
  .sw-token-row-sym { font-family:var(--sw-body); font-weight:700; font-size:13px; color:var(--sw-text); }
  .sw-token-row-name { font-size:11px; color:var(--sw-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sw-token-row-bal { font-family:var(--sw-mono); font-size:11px; color:var(--sw-cyan); flex-shrink:0; }
  .sw-wallet-row { width:100%; display:flex; align-items:center; gap:14px; padding:12px 14px; background:transparent; border:0; border-radius:13px; cursor:pointer; text-align:left; font-family:var(--sw-body); font-size:14px; font-weight:600; color:var(--sw-text); }
  .sw-wallet-row:hover { background:rgba(255,255,255,.06); }
  .sw-wallet-row .sw-wallet-name { flex:1; }
  .sw-wallet-row .sw-wallet-detect { font-family:var(--sw-mono); font-size:9px; color:var(--sw-cyan); letter-spacing:.1em; text-transform:uppercase; }
  @keyframes sw-spin { from{transform:rotate(0);} to{transform:rotate(360deg);} }
  @keyframes sw-pulse { 0%,100%{opacity:1; transform:scale(1);} 50%{opacity:.5; transform:scale(.7);} }
  @keyframes sw-hue { from{background-position:0% 0;} to{background-position:250% 0;} }
  @media (prefers-reduced-motion:reduce){ .sw-container::before, .sw-live-dot, .sw-primary-btn { animation:none; } .sw-flip-btn, .sw-token-btn, .sw-primary-btn { transition:none; } }
</style>
</head>
<body>
<main>
  <div class="marquee">
    <div class="marquee-track">
      <span>♥ NO KYC</span><span>✦ NO ACCOUNTS</span><span>∞ NO LIMITS</span>
      <span>SOL $184.35</span><span>♥ BUILT FOR THE FUTURE</span><span>✦ POWERED BY JUPITER</span>
      <span>JUP $0.71</span><span>♥ YOUR CRYPTO YOUR RULES</span>
      <span>♥ NO KYC</span><span>✦ NO ACCOUNTS</span><span>∞ NO LIMITS</span>
      <span>SOL $184.35</span><span>♥ BUILT FOR THE FUTURE</span><span>✦ POWERED BY JUPITER</span>
      <span>JUP $0.71</span><span>♥ YOUR CRYPTO YOUR RULES</span>
    </div>
  </div>

  <header>
    <div class="logo">
      <div class="logo-mark">✕</div>
      <div class="logo-text">VERIXIA</div>
    </div>
    <div class="header-msg">
      <div class="header-msg-l1">Swap <span class="grad">any</span> Solana token</div>
      <div class="header-msg-l2">No KYC · No limits</div>
      <div class="header-msg-l3"><span class="jup-mark">♃</span> Powered by Jupiter</div>
    </div>
    <div class="header-right">
      <div class="live-pill"><span class="pulse"></span>LIVE</div>
      <button class="connect" id="verixia-header-connect" type="button">Connect</button>
    </div>
  </header>

  <section class="hero">
    <div class="hero-content">
      <div class="pair-meta">
        <span class="dot"></span>
        <span>{{STATIC_INTRO}}</span>
      </div>
      <h1>{{STATIC_H1}}</h1>
      <div class="hero-msg-mobile">
        <div class="l1">Swap <span class="grad">any</span> Solana token</div>
        <div class="l2">No KYC · No limits</div>
        <div class="l3"><span class="jup-mark">♃</span> Powered by Jupiter</div>
      </div>
    </div>
  </section>

  <section class="swap-wrap">
    <div id="verixia-swap-root">
      <div class="swap-skeleton" aria-hidden="true">
        <div class="swap-skeleton-msg">
          <span class="dot"></span>
          <span class="skel-title">Swap</span>
          <span>Loading…</span>
        </div>
      </div>
    </div>
  </section>

  <div class="ticker">
    <div class="ticker-cell">
      <div class="lbl">Rate</div>
      <div class="val cy" id="ticker-rate">184.35</div>
    </div>
    <div class="ticker-cell">
      <div class="lbl">24h</div>
      <div class="val up">+2.4%</div>
    </div>
    <div class="ticker-cell">
      <div class="lbl">Vol</div>
      <div class="val">$48M</div>
    </div>
    <div class="ticker-cell">
      <div class="lbl">Settle</div>
      <div class="val">0.4s</div>
    </div>
  </div>

  <section class="brand-strip">
    <div class="tag-stack">
      <div class="tag-line"><span class="icon">🔒</span><span class="lbl">NO</span><span class="val">KYC</span></div>
      <div class="tag-line"><span class="icon">🕶</span><span class="lbl">NO</span><span class="val">ACCOUNTS</span></div>
      <div class="tag-line"><span class="icon">∞</span><span class="lbl">NO</span><span class="val">LIMITS</span></div>
    </div>
    <div class="signature">
      <p>YOUR CRYPTO. <span class="crown">♛</span></p>
      <p>YOUR WALLET. ♥</p>
      <p>YOUR RULES. ✦</p>
    </div>
  </section>

  <section class="section">
    <div class="section-tag">{{SUPP_HEADING}}</div>
    <h2 class="section-title">{{SUPP_INTRO}}</h2>
    {{AI_CONTENT}}
  </section>

  <section class="section">
    <div class="section-tag">FAQ</div>
    <h2 class="section-title">Common <span class="grad">questions</span></h2>
    {{RELATED_LINKS}}
  </section>

  <section class="section">
    <div class="section-tag">related</div>
    <h2 class="section-title">{{HUB_LINK}}</h2>
    <div class="pair-grid">{{MORE_LINKS}}</div>
  </section>

  <footer>
    <div class="marks">
      <span>YOUR CRYPTO.</span> <span class="crown">♛</span><br>
      <span class="pink">YOUR WALLET. ♥</span><br>
      <span class="cy">YOUR RULES. ✦</span>
    </div>
    <div class="links"><span>DOCS</span><span>X</span><span>DISCORD</span></div>
    <div class="legal">VERIXIA · POWERED BY JUPITER · NON-CUSTODIAL</div>
  </footer>

{{PAGE_META_SCRIPT}}

<script src="/embed/verixia-swap.js"></script>
</main>
</body>
</html>
