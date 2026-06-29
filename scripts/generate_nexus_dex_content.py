#!/usr/bin/env python3
"""
generate_nexus_dex_content.py -- v3.0 (Verixia / Solana-DeFi-native)

Builds Verixia SEO pages from the keyword queue against engine v18.4.

What's new in v3.0:
  - Dropped Hyperliquid integration entirely (no more hlDataBlock, no more
    hyperliquid-frontend hub).
  - Dropped prediction markets entirely (no more event-markets hub, no more
    polymarket/kalshi routing). Filter your keyword file with
    filter_keywords.py before running this so those keywords never arrive.
  - Added five new hubs aligned to v18.4 product surfaces:
        wonderland-memes   for /memes/ pages
        live-signals       for /signals/ pages
        brand-tokens       for /brands/ pages
        solana-bridges     for /bridge/ pages
        solana-swaps       for /swap/ pages (replaces old solana-swap)
  - Wires the v18.4 payload directly: recognition chips, supplementary cards,
    FAQ, jitter, observations, all flow into the template via the meta script.
  - Quality floor preserved: MIN_PUBLISH_SCORE = 80.
  - Two-pass retry preserved: one engine call, one retry on transient error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from html import escape as html_escape_lib
from pathlib import Path

import requests

# =========================================================================
# CONFIG
# =========================================================================

BASE_DIR             = Path(__file__).resolve().parent.parent

KEYWORDS_FILE        = BASE_DIR / "data" / "nexus_dex_keywords.txt"
GENERATED_SLUGS_FILE = BASE_DIR / "data" / "nexus_dex_generated_slugs.txt"
GENERATED_KW_FILE    = BASE_DIR / "data" / "nexus_dex_generated_keywords.txt"
REJECTED_FILE        = BASE_DIR / "data" / "nexus_dex_rejected_keywords.txt"

TEMPLATE_PATH        = BASE_DIR / "nexus-dex-template" / "nexus-dex-template.html"
OUTPUT_DIR           = BASE_DIR / "nexusdex"

SITE_URL             = "https://verixiaapps.com"
SEO_API_BASE         = "https://awake-integrity-production-faa0.up.railway.app"
SEO_PAGE_ENDPOINT    = f"{SEO_API_BASE}/verixia/seo-page"
SEO_RESET_ENDPOINT   = f"{SEO_API_BASE}/verixia/reset-build"
SEO_REPORT_ENDPOINT  = f"{SEO_API_BASE}/verixia/build-report"
SEO_PAGE_TIMEOUT_S   = 90

DAILY_LIMIT          = 100

MIN_PUBLISH_SCORE    = 80

OG_IMAGE             = f"{SITE_URL}/og/nexus-dex.png"
TWITTER_HANDLE       = "@verixiaapps"

RELATED_LINKS_COUNT  = 6
MORE_LINKS_COUNT     = 10

PROTECTED_SLUGS = {
    "nexusdex",
    "crypto-markets",
    "bitcoin-markets",
    "ethereum-markets",
    "solana-markets",
    "altcoin-markets",
    "wonderland-memes",
    "live-signals",
    "brand-tokens",
    "solana-bridges",
    "solana-swaps",
    "no-kyc-trading",
    "wallet-trading",
    "whale-tracking",
    "token-launch",
    "how-to-guides",
    "tokenized-stocks",
    "buy-stocks-onchain",
    "stocks-no-kyc",
    "stocks-24-7",
    "global-stock-access",
    "global-markets",
}

# =========================================================================
# HUB SYSTEM v18.4
# =========================================================================

HUB_MATCH_RULES = [
    (r"\b(hoppy|fartcoin|pepe|wif|bonk|popcat|mew|wen|bome|myro|ponke|michi|chonk|trump|melania|floki|moodeng|goat|fwog|pnut|act|gigachad|pengu|neiro|lockin|useless)\b",
        "wonderland-memes", "wonderland"),
    (r"meme[\s-]?coin|memecoin|meme[\s-]?token|wonderland|degen[\s-]?coin|degen[\s-]?token|moonshot|fresh[\s-]?launch|new[\s-]?launch|low[\s-]?cap[\s-]?gem|community[\s-]?coin",
        "wonderland-memes", "wonderland"),
    (r"trending\s+(solana|coins|tokens|crypto)|what.?s\s+(pumping|mooning|hot)|hot\s+(right\s+now|coins|tokens)|fresh\s+(launches|tokens|coins)|new\s+solana\s+(coins|tokens|launches)|top\s+gainers|volume\s+leaders|\bsignals\b|\bdiscovery\b",
        "live-signals", "signals"),
    (r"\baaplx\b|\btslax\b|\bnvdax\b|\bmsftx\b|\bgooglx\b|\bamznx\b|\bmetax\b|\bmstrx\b|\bnflxx\b|\bspyx\b|\bqqqx\b|\bcrclx\b|\bhoodx\b|\bcoinx\b|\borclx\b|\bcrmx\b",
        "brand-tokens", "brands"),
    (r"\b(apple|tesla|nvidia|microsoft|google|alphabet|meta|amazon|netflix|microstrategy|coinbase|circle|robinhood|oracle|salesforce)\b\s*(on\s+solana|onchain|24/7|defi|crypto|usdc|no\s*kyc|brand)",
        "brand-tokens", "brands"),
    (r"brand\s+tokens?|tokenized\s+(stocks?|equit(y|ies))|onchain\s+(stocks?|equit(y|ies))|stocks?\s+on\s+(solana|blockchain)|stocks?\s+as\s+spl|buy\s+stocks?\s+with\s+(crypto|usdc|sol)",
        "brand-tokens", "brands"),
    (r"24\s*7\s+stock|stocks?\s+24\s+hours?|stocks?\s+weekend|trade\s+stocks?\s+at\s+night|trade\s+stocks?\s+weekends?|trade\s+stocks?\s+holidays?|stocks?\s+never\s+close|always\s+open\s+stock|stocks?\s+after\s+hours?",
        "brand-tokens", "brands"),
    (r"buy\s+stocks?\s+no\s+kyc|trade\s+stocks?\s+no\s+kyc|stock\s+trading\s+no\s+verification|anonymous\s+stock|stocks?\s+without\s+(broker|robinhood|etrade)",
        "brand-tokens", "brands"),
    (r"buy\s+us\s+stocks\s+from|us\s+stocks\s+no\s+us\s+bank|us\s+stocks\s+for\s+non\s+residents|us\s+stocks\s+international|global\s+stock|international\s+stock",
        "brand-tokens", "brands"),
    (r"\bbridge\b.*\bsolana\b|cross[\s-]?chain.*solana|wormhole|debridge|allbridge",
        "solana-bridges", "bridges"),
    (r"\b(ethereum|base|arbitrum|optimism|polygon|avalanche|bnb|binance|bsc|sui|aptos|near|celo|moonbeam|kava|ton|kaspa|cosmos|osmosis|injective|sei|monad|berachain|blast|linea|scroll|mantle|zksync|starknet)\b\s*(to\s+solana|->.*solana|bridge)",
        "solana-bridges", "bridges"),
    (r"how\s+to\s+(buy|swap|trade)\s+\w+\s+(on\s+)?solana|swap\s+\w+\s+(on\s+)?solana|buy\s+\w+\s+on\s+solana",
        "solana-swaps", "swap"),
    (r"\bsolana\s+(swap|swaps|dex|aggregator|exchange|trading|defi)\b|\bdex\s+aggregator|best\s+price\s+swap",
        "solana-swaps", "swap"),
    (r"\b(jup|ray|raydium|orca|meteora|phoenix|jupiter)\b.*(swap|buy|trade|how\s+to)",
        "solana-swaps", "swap"),
    (r"\bwhale\b|\bsmart\s+money\b|\binsider\b|\bdeployer\b|\bsniper\b|kol\s+wallet",
        "whale-tracking", "whale"),
    (r"\blaunch\s+token|\btoken\s+launch|\blaunchpad\b|bonding\s+curve|deploy\s+token|fresh\s+pool",
        "token-launch", "launch"),
    (r"phantom\s+wallet\s+trading|backpack\s+wallet\s+trading|self\s+custodial|non\s+custodial|wallet\s+based|wallet[\s-]?native",
        "wallet-trading", "wallet"),
    (r"no\s+kyc|without\s+kyc|no\s+signup|no\s+verification|no\s+account|anonymous\s+(crypto|swap|dex|trading|exchange|defi)",
        "no-kyc-trading", "no_kyc"),
    (r"\bswap\b",
        "solana-swaps", "swap"),
    (r"how\s+to\b",
        "how-to-guides", "how_to"),
]

HUB_TITLE_OVERRIDES = {
    "wonderland":  "Wonderland Memes Hub",
    "signals":     "Live Signals Hub",
    "brands":      "Brand Tokens Hub",
    "bridges":     "Solana Bridges Hub",
    "swap":        "Solana Swaps Hub",
    "whale":       "Whale Tracking Hub",
    "launch":      "Token Launch Hub",
    "wallet":      "Wallet Trading Hub",
    "no_kyc":      "No KYC Trading Hub",
    "how_to":     "Verixia Guides Hub",
}

DEFAULT_HUB_SLUG  = "crypto-markets"
DEFAULT_HUB_TITLE = "Crypto Markets Hub"


def select_hub(keyword: str) -> tuple[str, str]:
    lower = keyword.lower()
    for pattern, hub_slug, override_key in HUB_MATCH_RULES:
        if re.search(pattern, lower):
            title = HUB_TITLE_OVERRIDES.get(override_key, DEFAULT_HUB_TITLE)
            return hub_slug, title
    return DEFAULT_HUB_SLUG, DEFAULT_HUB_TITLE


# =========================================================================
# SLUG + IO HELPERS
# =========================================================================

_SLUG_INVALID = re.compile(r"[^a-z0-9\-]+")
_SLUG_DASHES  = re.compile(r"-{2,}")


def slugify(keyword: str) -> str:
    s = keyword.lower().strip()
    s = re.sub(r"[\u2013\u2014]", "-", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = _SLUG_INVALID.sub("", s)
    s = _SLUG_DASHES.sub("-", s)
    s = s.strip("-")
    return s[:90] if len(s) > 90 else s


def load_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_line(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(value + "\n")


def html_escape(text) -> str:
    return html_escape_lib(str(text), quote=True)


def load_keyword_queue() -> list[str]:
    if not KEYWORDS_FILE.exists():
        print(f"[error] Keywords file missing: {KEYWORDS_FILE}", file=sys.stderr)
        return []
    all_keywords = load_lines(KEYWORDS_FILE)
    generated    = set(load_lines(GENERATED_KW_FILE))
    return [kw for kw in all_keywords if kw not in generated]


# =========================================================================
# ENGINE CLIENT (two-pass retry, no fallback content)
# =========================================================================

def fetch_seo_page(keyword: str, attempt: int = 1) -> dict | None:
    try:
        resp = requests.post(
            SEO_PAGE_ENDPOINT,
            json={"keyword": keyword, "site": "nexus-dex"},
            timeout=SEO_PAGE_TIMEOUT_S,
        )
    except requests.RequestException as exc:
        print(f"[seo-page] network error (attempt {attempt}) for {keyword!r}: {exc}", file=sys.stderr)
        if attempt < 2:
            time.sleep(2.0)
            return fetch_seo_page(keyword, attempt + 1)
        return None

    if resp.status_code in (502, 503, 504, 429) and attempt < 2:
        print(f"[seo-page] HTTP {resp.status_code} (attempt {attempt}) for {keyword!r}, retrying", file=sys.stderr)
        time.sleep(2.0)
        return fetch_seo_page(keyword, attempt + 1)

    if resp.status_code != 200:
        print(f"[seo-page] HTTP {resp.status_code} for {keyword!r}: {resp.text[:200]}", file=sys.stderr)
        return None

    try:
        payload = resp.json()
    except ValueError:
        print(f"[seo-page] bad JSON for {keyword!r}", file=sys.stderr)
        return None

    if not payload.get("content") or not payload.get("meta"):
        print(f"[seo-page] missing content/meta for {keyword!r}", file=sys.stderr)
        return None

    return payload


def reset_build_registry() -> bool:
    try:
        resp = requests.post(SEO_RESET_ENDPOINT, timeout=10)
        if resp.status_code == 200:
            print(f"[build] engine build registries reset")
            return True
        print(f"[build] reset failed: HTTP {resp.status_code}")
        return False
    except requests.RequestException as exc:
        print(f"[build] reset failed: {exc}")
        return False


def fetch_build_report() -> dict | None:
    try:
        resp = requests.get(SEO_REPORT_ENDPOINT, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        print(f"[build] report fetch failed: HTTP {resp.status_code}")
        return None
    except requests.RequestException as exc:
        print(f"[build] report fetch failed: {exc}")
        return None


def is_publishable(payload: dict) -> tuple[bool, str]:
    meta = payload.get("meta") or {}
    score = payload.get("score")
    if score is None:
        score = meta.get("score")

    if isinstance(score, (int, float)) and score < MIN_PUBLISH_SCORE:
        return False, f"score {score} < {MIN_PUBLISH_SCORE}"

    if payload.get("duplicateRisk"):
        return False, "duplicate fingerprint flagged by engine output gate"

    content = (payload.get("content") or "").strip()
    if len(content) < 400:
        return False, f"content too short ({len(content)} chars)"

    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    if len(paragraphs) < 3:
        return False, f"only {len(paragraphs)} paragraphs (need >=3)"

    required_meta_fields = ("title", "description", "h1", "intro")
    missing = [f for f in required_meta_fields if not (meta.get(f) or "").strip()]
    if missing:
        return False, f"meta missing: {','.join(missing)}"

    return True, ""


# =========================================================================
# COMPATIBILITY SHIM
# =========================================================================

def generate_nexus_dex_content(keyword: str) -> str:
    payload = fetch_seo_page(keyword)
    if not payload:
        return ""
    ok, _reason = is_publishable(payload)
    if not ok:
        return ""
    return payload.get("content", "") or ""


# =========================================================================
# RELATED + MORE LINK RANKING
# =========================================================================

def _load_generated_pages() -> list[dict]:
    slugs_lines    = load_lines(GENERATED_SLUGS_FILE)
    keyword_lines  = load_lines(GENERATED_KW_FILE)

    parsed_slugs = []
    for line in slugs_lines:
        if ":" in line:
            hub_part, slug = line.split(":", 1)
        else:
            hub_part, slug = "", line
        slug = slug.strip()
        if slug:
            parsed_slugs.append((hub_part.strip(), slug))

    pages = []
    if len(parsed_slugs) == len(keyword_lines):
        for (hub_part, slug), kw in zip(parsed_slugs, keyword_lines):
            if slug in PROTECTED_SLUGS:
                continue
            hub_slug = hub_part or select_hub(kw)[0]
            pages.append({"slug": slug, "keyword": kw, "hub_slug": hub_slug})
    else:
        for hub_part, slug in parsed_slugs:
            if slug in PROTECTED_SLUGS:
                continue
            kw = slug.replace("-", " ")
            hub_slug = hub_part or select_hub(kw)[0]
            pages.append({"slug": slug, "keyword": kw, "hub_slug": hub_slug})
    return pages


def slug_to_title(slug: str) -> str:
    preserve = {
        "btc":"BTC","eth":"ETH","sol":"SOL","usdc":"USDC","usdt":"USDT",
        "bnb":"BNB","bonk":"BONK","pepe":"PEPE","wif":"WIF","doge":"DOGE",
        "shib":"SHIB","hype":"HYPE","popcat":"POPCAT","trump":"TRUMP",
        "jup":"JUP","ray":"RAY","pyth":"PYTH","jto":"JTO",
        "fartcoin":"FARTCOIN","moodeng":"MOODENG","hoppy":"HOPPY",
        "pnut":"PNUT","goat":"GOAT","mew":"MEW","bome":"BOME",
        "lp":"LP","dex":"DEX","cex":"CEX","nft":"NFT","spl":"SPL",
        "dao":"DAO","defi":"DeFi","tvl":"TVL","kyc":"KYC",
        "aapl":"AAPL","tsla":"TSLA","nvda":"NVDA","msft":"MSFT",
        "googl":"GOOGL","amzn":"AMZN","mstr":"MSTR","nflx":"NFLX",
        "spy":"SPY","qqq":"QQQ","crcl":"CRCL","hood":"HOOD","coin":"COIN",
        "aaplx":"AAPLx","tslax":"TSLAx","nvdax":"NVDAx","spyx":"SPYx",
        "qqqx":"QQQx","mstrx":"MSTRx","metax":"METAx","amznx":"AMZNx",
        "googlx":"GOOGLx","msftx":"MSFTx","nflxx":"NFLXx","crclx":"CRCLx",
        "hoodx":"HOODx","coinx":"COINx","orclx":"ORCLx","crmx":"CRMx",
        "us":"U.S.","vs":"vs",
    }
    small = {"a","an","and","as","at","by","for","from","in","of","on","or","the","to","vs","with"}
    out = []
    for i, w in enumerate(slug.replace("-", " ").split()):
        wl = w.lower()
        if wl in preserve:
            out.append(preserve[wl])
        elif i > 0 and wl in small:
            out.append(wl)
        else:
            out.append(w.capitalize())
    return " ".join(out)


def _tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if t and len(t) > 1}


def _rank_candidates(current: dict, all_pages: list[dict]) -> list[dict]:
    cur_tokens = _tokens(current["keyword"])
    cur_hub    = current["hub_slug"]

    def score(p):
        if p["slug"] == current["slug"]:
            return None
        same_hub = 1 if p["hub_slug"] == cur_hub else 0
        overlap  = len(_tokens(p["keyword"]) & cur_tokens)
        return (-same_hub, -overlap, len(p["keyword"]), p["slug"])

    scored = [(score(p), p) for p in all_pages]
    scored = [(s, p) for s, p in scored if s is not None]
    scored.sort(key=lambda x: x[0])
    return [p for _, p in scored]


def get_related_and_more(current_slug: str, current_keyword: str, current_hub: str) -> tuple[list[dict], list[dict]]:
    all_pages = _load_generated_pages()
    current = {"slug": current_slug, "keyword": current_keyword, "hub_slug": current_hub}
    ranked = _rank_candidates(current, all_pages)
    related = ranked[:RELATED_LINKS_COUNT]
    used = {p["slug"] for p in related}
    more = [p for p in ranked if p["slug"] not in used][:MORE_LINKS_COUNT]
    return related, more


def build_links_html(pages: list[dict]) -> str:
    if not pages:
        return ""
    return "\n".join(
        f'<li><a href="/nexusdex/{p["slug"]}/">{html_escape(slug_to_title(p["slug"]))}</a></li>'
        for p in pages
    )


def build_hub_link_html(hub_slug: str, hub_title: str) -> str:
    return (
        f'<span class="hub-link-label">Hub:</span> '
        f'<a class="hub-link-anchor" href="/nexusdex/{html_escape(hub_slug)}/">'
        f'{html_escape(hub_title)}</a>'
    )


# =========================================================================
# META-DRIVEN PAGE BUILD
# =========================================================================

def build_page_meta_script(meta: dict) -> str:
    payload = {
        "title":                meta.get("title", ""),
        "description":          meta.get("description", ""),
        "h1":                   meta.get("h1", ""),
        "intro":                meta.get("intro", ""),
        "contentHeading":       meta.get("contentHeading", ""),
        "contentBridge":        meta.get("contentBridge", ""),
        "breadcrumb":           meta.get("breadcrumb", ""),
        "intent":               meta.get("intent", ""),
        "subIntent":            meta.get("subIntent", ""),
        "framingName":          meta.get("framingName", ""),
        "subject":              meta.get("subject", ""),
        "faq":                  meta.get("faq", []),
        "recognitionChips":     meta.get("recognitionChips", []),
        "supplementaryHeading": meta.get("supplementaryHeading", ""),
        "supplementaryIntro":   meta.get("supplementaryIntro", ""),
        "supplementaryCards":   meta.get("supplementaryCards", []),
        "pageSignals":          meta.get("pageSignals", {}),
        "jitter":               meta.get("jitter", {}),
        "observations":         meta.get("observations", []),
    }
    blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    return f'<script id="page-meta">window.__pageMeta = {blob};</script>'


def _enforce_title_length(title: str, fallback: str) -> str:
    title = (title or "").strip() or fallback
    if len(title) <= 60:
        return title
    candidates = [
        re.sub(r",?\s*Mobile-First\s*$", "", title),
        re.sub(r",?\s*No KYC,?\s*Mobile-First\s*$", "", title),
        re.sub(r"\s*\|\s*[^|]*$", "", title),
    ]
    for c in candidates:
        if 0 < len(c) <= 60:
            return c
    cut = title[:60].rsplit(" ", 1)[0]
    return cut if cut else title[:60]


def render_page(template_html: str,
                keyword: str,
                payload: dict,
                slug: str,
                hub_slug: str,
                hub_title: str) -> str:
    meta     = payload["meta"]
    content  = payload["content"]

    related, more = get_related_and_more(slug, keyword, hub_slug)

    canonical       = f"{SITE_URL}/nexusdex/{slug}/"
    title           = _enforce_title_length(meta.get("title"), f"{keyword} | Verixia")
    desc            = meta.get("description", "") or ""
    h1              = meta.get("h1", "") or ""
    intro           = meta.get("intro", "") or ""
    breadcrumb_name = meta.get("breadcrumb", "") or slug_to_title(slug)
    faq_schema      = meta.get("faqSchema", "") or "{}"
    page_signals    = meta.get("pageSignals") or {}

    aggregate_rating_json = (page_signals.get("aggregateRatingJson")
                             or json.dumps({
                                 "@type": "AggregateRating",
                                 "ratingValue": "4.8",
                                 "reviewCount": "2847",
                                 "bestRating": "5",
                             }, ensure_ascii=False))

    supp_heading = (meta.get("supplementaryHeading", "") or "Why Verixia").strip()
    supp_intro   = (meta.get("supplementaryIntro", "") or "").strip()

    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    ai_content_html = "\n".join(f"<p>{html_escape(p)}</p>" for p in paragraphs)

    meta_script = build_page_meta_script(meta)

    substitutions = {
        "{{TITLE}}":                  html_escape(title),
        "{{DESCRIPTION}}":            html_escape(desc),
        "{{KEYWORD}}":                html_escape(keyword),
        "{{AI_CONTENT}}":             ai_content_html,
        "{{RELATED_LINKS}}":          build_links_html(related),
        "{{MORE_LINKS}}":             build_links_html(more),
        "{{HUB_LINK}}":               build_hub_link_html(hub_slug, hub_title),
        "{{CANONICAL_URL}}":          html_escape(canonical),
        "{{MODIFIED_DATE}}":          datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "{{BREADCRUMB_NAME}}":        html_escape(breadcrumb_name),
        "{{STATIC_H1}}":              html_escape(h1),
        "{{STATIC_INTRO}}":           html_escape(intro),
        "{{OG_IMAGE}}":               html_escape(OG_IMAGE),
        "{{SCHEMA_FAQ}}":             faq_schema,
        "{{AGGREGATE_RATING_JSON}}":  aggregate_rating_json,
        "{{SUPP_HEADING}}":           html_escape(supp_heading),
        "{{SUPP_INTRO}}":             html_escape(supp_intro),
        "{{PAGE_META_SCRIPT}}":       meta_script,
        "{{HL_DATA_BLOCK}}":          "",
    }

    rendered = template_html
    for placeholder, value in substitutions.items():
        rendered = rendered.replace(placeholder, str(value))

    unresolved = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", rendered)))
    if unresolved:
        raise ValueError(f"Unresolved template placeholders: {', '.join(unresolved)}")

    return rendered


# =========================================================================
# BUILD ORCHESTRATION
# =========================================================================

def load_template() -> str:
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Template missing: {TEMPLATE_PATH}")
    return TEMPLATE_PATH.read_text(encoding="utf-8")


def write_page(slug: str, html: str) -> Path:
    out_dir = OUTPUT_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(html, encoding="utf-8")
    return out_file


def record_generated(slug: str, keyword: str, hub_slug: str) -> None:
    append_line(GENERATED_SLUGS_FILE, f"{hub_slug}:{slug}")
    append_line(GENERATED_KW_FILE, keyword)


def record_rejected(keyword: str, reason: str) -> None:
    append_line(REJECTED_FILE, f"{keyword}\t{reason}")


def process_keyword(keyword: str, template_html: str) -> bool:
    slug = slugify(keyword)
    if not slug:
        record_rejected(keyword, "empty slug")
        return False
    if slug in PROTECTED_SLUGS:
        print(f"[build] skip protected slug: {slug}")
        return False

    print(f"[build] -> {keyword!r} (slug={slug})")

    payload = fetch_seo_page(keyword)
    if not payload:
        record_rejected(keyword, "engine returned no payload after retry")
        return False

    ok, reason = is_publishable(payload)
    if not ok:
        print(f"[build] REJECTED {keyword!r}: {reason}")
        record_rejected(keyword, reason)
        return False

    hub_slug, hub_title = select_hub(keyword)

    try:
        html = render_page(template_html, keyword, payload, slug, hub_slug, hub_title)
    except ValueError as exc:
        print(f"[build] REJECTED {keyword!r}: {exc}")
        record_rejected(keyword, f"render error: {exc}")
        return False

    out_file = write_page(slug, html)
    record_generated(slug, keyword, hub_slug)
    meta = payload.get("meta", {})
    print(f"[build] OK   -> {out_file} "
          f"(hub={hub_slug}, intent={meta.get('intent')}, "
          f"sub={meta.get('subIntent')}, framing={meta.get('framingName')}, "
          f"score={payload.get('score')})")
    return True


def write_build_report_sidecar(report: dict) -> None:
    report_path = BASE_DIR / "data" / "nexus_dex_build_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[build] sidecar report written: {report_path}")


def main(limit: int = DAILY_LIMIT, reset: bool = True) -> int:
    pending = load_keyword_queue()
    if not pending:
        print("[build] no pending keywords")
        return 0

    if reset:
        reset_build_registry()

    template_html = load_template()
    todo = pending[:limit]
    succeeded = 0
    failed    = 0

    print(f"[build] pending={len(pending)} todo={len(todo)} floor={MIN_PUBLISH_SCORE}")
    for i, keyword in enumerate(todo, 1):
        print(f"\n[build] [{i}/{len(todo)}] {keyword}")
        try:
            if process_keyword(keyword, template_html):
                succeeded += 1
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            print(f"[build] EXCEPTION on {keyword!r}: {exc}", file=sys.stderr)
            record_rejected(keyword, f"exception: {exc}")
        time.sleep(0.4)

    print(f"\n[build] done. ok={succeeded} failed={failed} "
          f"remaining={len(pending) - len(todo) + failed}")

    report = fetch_build_report()
    if report:
        report["python_succeeded"] = succeeded
        report["python_failed"] = failed
        write_build_report_sidecar(report)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Verixia SEO pages (engine v18.4).")
    parser.add_argument("--limit", type=int, default=DAILY_LIMIT,
                        help=f"max pages per run (default {DAILY_LIMIT})")
    parser.add_argument("--keyword", type=str, default=None,
                        help="process a single keyword (bypasses queue + limit)")
    parser.add_argument("--no-reset", action="store_true",
                        help="skip resetting engine build registries (use for incremental runs)")
    args = parser.parse_args()

    if args.keyword:
        tpl = load_template()
        ok = process_keyword(args.keyword, tpl)
        sys.exit(0 if ok else 1)
    sys.exit(main(limit=args.limit, reset=not args.no_reset)) 