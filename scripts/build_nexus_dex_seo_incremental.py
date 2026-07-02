#!/usr/bin/env python3
"""
build_nexus_dex_seo_incremental.py -- v4.5 (rebuild-safe timeout)

WHAT CHANGED vs v4.4
--------------------
  - Added an opt-in graceful shutdown for full rebuilds ONLY. When REBUILD_MODE
    is set (the rebuild workflow step sets REBUILD_MODE=true), SIGTERM/SIGINT
    now flip a stop flag instead of hard-killing the process. The generation
    loop notices the flag, stops after the current page, and falls through to
    the normal end-of-run git_checkpoint() -- so a workflow timeout commits and
    pushes every completed page before the runner's SIGKILL. Without this, up to
    COMMIT_EVERY-1 finished pages were re-generated on the resume run.
  - The daily incremental run does NOT set REBUILD_MODE, so its behavior is
    byte-for-byte identical to v4.4 (no handler installed).

Unchanged from v4.4:
  - Removed fake AggregateRating; template placeholder set matches template.
  - Hub routing aligned to the 11 built hubs.
  - De-perped ranking signals.
  - Pages ship to public/<slug>/index.html
  - Canonical/og/JSON-LD URLs use swap.verixiaapps.com
  - Sitemap rebuilt to public/nexus-sitemap.xml on every COMMIT_EVERY checkpoint
  - Engine score gate (is_publishable), resume, git checkpoint/push
"""

import os
import re
import sys
import json
import subprocess
import signal
from datetime import datetime, timezone
from html import escape

BASE_DIR    = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

from generate_nexus_dex_content import (
    fetch_seo_page,
    is_publishable,
    build_page_meta_script,
    reset_build_registry,
    fetch_build_report,
)

# -----------------------------
# GRACEFUL SHUTDOWN (rebuild only)
# -----------------------------
# Set by SIGTERM/SIGINT when REBUILD_MODE is on, so a workflow timeout can flush
# a final checkpoint (commit + push of completed pages) before the runner sends
# SIGKILL. Handlers are only installed during a full rebuild; the daily
# incremental run never arms this and behaves exactly as before.
_STOP_REQUESTED = False


def _request_stop(signum, frame):
    global _STOP_REQUESTED
    _STOP_REQUESTED = True


# -----------------------------
# CONFIG
# -----------------------------
KEYWORD_FILE            = os.path.join(BASE_DIR, "data", "nexus_dex_keywords.txt")
GENERATED_SLUGS_FILE    = os.path.join(BASE_DIR, "data", "nexus_dex_generated_slugs.txt")
GENERATED_KEYWORDS_FILE = os.path.join(BASE_DIR, "data", "nexus_dex_generated_keywords.txt")
REJECTED_KEYWORDS_FILE  = os.path.join(BASE_DIR, "data", "nexus_dex_rejected_keywords.txt")

TEMPLATE_FILE = os.path.join(BASE_DIR, "template", "defi-template.html")
OUTPUT_DIR    = os.path.join(BASE_DIR, "public")
SITEMAP_FILE  = os.path.join(OUTPUT_DIR, "nexus-sitemap.xml")

# SITE is the parent brand origin (used for og:image). SWAP_SITE is where the
# SEO pages are served from (same origin as the approved swap dApp), so
# canonical/og/JSON-LD URLs point there.
SITE      = "https://verixiaapps.com"
SWAP_SITE = "https://swap.verixiaapps.com"
OG_IMAGE  = f"{SITE}/og/nexus-dex.png"

RELATED_LINKS_COUNT = 6
MORE_LINKS_COUNT    = 10
DAILY_LIMIT         = int(os.getenv("DAILY_LIMIT", "100"))
COMMIT_EVERY        = int(os.getenv("COMMIT_EVERY", "30"))
RESUME              = os.getenv("RESUME", "true").lower() == "true"
RESET_ENGINE        = os.getenv("RESET_ENGINE", "false").lower() == "true"

# ---- Cross-domain linking to the token-risk pages ----
# Each swap page links to REAL token-risk pages. We read the token-risk repo's
# live sitemap once per run, extract real slugs, and match ones sharing keyword
# tokens with the current page. Real pages only -> no 404s. Falls back to risk
# hub slugs when there's no match. Set CROSS_SITEMAP_URL="" to use hubs only.
CROSS_SITEMAP_URL    = os.getenv(
    "CROSS_SITEMAP_URL", "https://verixiaapps.com/token-risk-sitemap.xml"
)
CROSS_LINKS_PER_PAGE = int(os.getenv("CROSS_LINKS_PER_PAGE", "6"))
CROSS_RISK_HUBS      = [
    ("solana-token-risk",  "Solana token risk checker"),
    ("token-safety-check", "Token safety check"),
    ("meme-token-risk",    "Meme coin risk checker"),
    ("token-risk-hub",     "All token risk guides"),
]
# Only full rebuilds set this. When on, we install the SIGTERM/SIGINT handlers
# above so a timeout flushes a final checkpoint instead of losing the batch.
REBUILD_MODE        = os.getenv("REBUILD_MODE", "false").lower() == "true"

# Slugs we never overwrite: CRA-managed public/ files, reserved server.js
# routes, and the 11 SEO hub slugs (built by build_nexus_dex_hubs.py). If a
# generated keyword slugifies into one of these, skip it so we never shadow a
# real route or a hub landing page.
PROTECTED_SLUGS = {
    # CRA public/ entries -- never overwrite these
    "index.html", "favicon.ico", "manifest.json", "robots.txt",
    "asset-manifest.json", "logo192.png", "logo512.png",
    # Reserved server.js routes
    "nexus-dex", "health", "api", "embed",
    # SEO hub slugs (the 11 hubs build_nexus_dex_hubs.py builds)
    "crypto-markets",
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
}
FALLBACK_HUB_SLUG = "crypto-markets"

# v4 template placeholder set (exactly matches defi-template.html). No
# {{AGGREGATE_RATING_JSON}} -- that schema was removed.
REQUIRED_TEMPLATE_PLACEHOLDERS = {
    "{{TITLE}}",
    "{{DESCRIPTION}}",
    "{{KEYWORD}}",
    "{{AI_CONTENT}}",
    "{{RELATED_LINKS}}",
    "{{MORE_LINKS}}",
    "{{HUB_LINK}}",
    "{{CANONICAL_URL}}",
    "{{OG_IMAGE}}",
    "{{MODIFIED_DATE}}",
    "{{BREADCRUMB_NAME}}",
    "{{SCHEMA_FAQ}}",
    "{{FAQ_STATIC}}",
    "{{STATIC_H1}}",
    "{{STATIC_INTRO}}",
    "{{SUPP_HEADING}}",
    "{{SUPP_INTRO}}",
    "{{PAGE_META_SCRIPT}}",
    "{{TOKEN_RISK_LINK}}",
}

# Ranking-only signal sets (used for internal-link relatedness + ordering).
# De-perped: no perps/leverage/hyperliquid/insider/sniper/deployer/kol or
# stock-broker terms -- those product surfaces no longer exist.
NEXUS_DEX_CLUSTER_TERMS = {
    "swap", "buy", "sell", "trade", "trading", "dex", "cex", "kyc",
    "wallet", "mobile", "app", "self", "custodial", "non",
    "phantom", "backpack", "solflare", "jupiter", "raydium", "orca",
    "meteora", "whale", "smart", "money", "holder", "holders", "concentration",
    "launch", "launchpad", "bonding", "curve", "graduate", "fair",
    "solana", "ethereum", "bitcoin", "btc", "eth", "sol", "usdc", "usdt",
    "base", "bsc", "arbitrum", "polygon", "spl", "memecoin", "altcoin",
    "tokenized", "stocks", "stock", "brand", "onchain",
    "aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax", "mstrx",
    "nflxx", "spyx", "qqqx", "crclx",
    "wonderland", "meme", "memes", "ape", "degen",
    "hoppy", "fartcoin", "popcat", "wif", "bonk", "mew", "wen",
    "bome", "myro", "ponke", "michi", "trump", "moodeng", "goat", "pnut",
    "fresh", "trending", "signals", "discovery", "gainers", "volume", "leaders",
    "hot", "pumping", "live",
    "bridge", "bridges", "wormhole", "debridge", "allbridge",
    "anonymous", "permissionless", "aggregator", "best", "price", "global", "no",
}

BRAND_CASE = {
    "nexus dex": "Nexus DEX",
    "verixia": "Verixia",
    "binance smart chain": "Binance Smart Chain",
    "trust wallet": "Trust Wallet",
    "raydium launchlab": "Raydium LaunchLab",
    "pump fun": "Pump Fun",
    "wonderland": "Wonderland",
    "dexscreener": "Dexscreener",
    "pancakeswap": "PancakeSwap",
    "uniswap": "Uniswap",
    "raydium": "Raydium",
    "coinbase": "Coinbase",
    "robinhood": "Robinhood",
    "kraken": "Kraken",
    "bybit": "Bybit",
    "kamino": "Kamino",
    "ethereum": "Ethereum",
    "avalanche": "Avalanche",
    "arbitrum": "Arbitrum",
    "polygon": "Polygon",
    "optimism": "Optimism",
    "phantom": "Phantom",
    "backpack": "Backpack",
    "solflare": "Solflare",
    "bitcoin": "Bitcoin",
    "solana": "Solana",
    "binance": "Binance",
    "jupiter": "Jupiter",
    "meteora": "Meteora",
    "phoenix": "Phoenix",
    "lifinity": "Lifinity",
    "orca": "Orca",
    "wormhole": "Wormhole",
    "debridge": "deBridge",
    "allbridge": "Allbridge",
    "crypto": "Crypto",
    "market": "Market",
    "wallet": "Wallet",
    "xstocks": "xStocks",
    "xstock": "xStock",
    "aaplx": "AAPLx",
    "tslax": "TSLAx",
    "nvdax": "NVDAx",
    "msftx": "MSFTx",
    "googlx": "GOOGLx",
    "amznx": "AMZNx",
    "metax": "METAx",
    "mstrx": "MSTRx",
    "nflxx": "NFLXx",
    "spyx": "SPYx",
    "qqqx": "QQQx",
    "crclx": "CRCLx",
    "hoodx": "HOODx",
    "coinx": "COINx",
    "orclx": "ORCLx",
    "crmx": "CRMx",
    "apple": "Apple",
    "tesla": "Tesla",
    "nvidia": "Nvidia",
    "microsoft": "Microsoft",
    "google": "Google",
    "alphabet": "Alphabet",
    "amazon": "Amazon",
    "netflix": "Netflix",
    "microstrategy": "MicroStrategy",
    "circle": "Circle",
    "oracle": "Oracle",
    "salesforce": "Salesforce",
    "bsc": "BSC",
    "eth": "ETH",
    "btc": "BTC",
    "sol": "SOL",
    "usdc": "USDC",
    "usdt": "USDT",
    "bnb": "BNB",
    "base": "Base",
    "blast": "Blast",
    "sui": "Sui",
    "aptos": "Aptos",
    "ton": "TON",
    "trx": "TRX",
    "tron": "Tron",
    "bonk": "BONK",
    "wif": "WIF",
    "pepe": "PEPE",
    "doge": "DOGE",
    "shib": "SHIB",
    "trump": "TRUMP",
    "popcat": "POPCAT",
    "hoppy": "HOPPY",
    "fartcoin": "FARTCOIN",
    "moodeng": "MOODENG",
    "pnut": "PNUT",
    "goat": "GOAT",
    "mew": "MEW",
    "wen": "WEN",
    "bome": "BOME",
    "myro": "MYRO",
    "ponke": "PONKE",
    "michi": "MICHI",
    "floki": "FLOKI",
    "fwog": "FWOG",
    "pengu": "PENGU",
    "neiro": "NEIRO",
    "useless": "USELESS",
    "jup": "JUP",
    "ray": "RAY",
    "pyth": "PYTH",
    "jto": "JTO",
    "ai16z": "ai16z",
    "dex": "DEX",
    "cex": "CEX",
    "kyc": "KYC",
    "spl": "SPL",
    "nft": "NFT",
    "dao": "DAO",
    "defi": "DeFi",
    "tvl": "TVL",
    "evm": "EVM",
    "etf": "ETF",
    "rwa": "RWA",
    "us": "U.S.",
}

SMALL_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
    "or", "the", "to", "vs", "with",
}

# The 11 hubs that build_nexus_dex_hubs.py actually builds.
HUB_TITLE_OVERRIDES = {
    "wonderland-memes": "Wonderland Memes Hub",
    "live-signals":     "Live Signals Hub",
    "brand-tokens":     "Brand Tokens Hub",
    "solana-bridges":   "Solana Bridges Hub",
    "solana-swaps":     "Solana Swaps Hub",
    "no-kyc-trading":   "No KYC Trading Hub",
    "wallet-trading":   "Wallet Trading Hub",
    "whale-tracking":   "Whale Tracking Hub",
    "token-launch":     "Token Launch Hub",
    "how-to-guides":    "Verixia Guides Hub",
    "crypto-markets":   "Crypto Markets Hub",
}

# Order matters: most specific first, generic catch-alls last. Every target is
# one of the 11 built hubs, so {{HUB_LINK}} always resolves.
HUB_MATCH_RULES = [
    # memes / wonderland
    ("hoppy", "wonderland-memes"),
    ("fartcoin", "wonderland-memes"),
    ("popcat", "wonderland-memes"),
    ("wif", "wonderland-memes"),
    ("bonk", "wonderland-memes"),
    ("pepe", "wonderland-memes"),
    ("mew", "wonderland-memes"),
    ("bome", "wonderland-memes"),
    ("myro", "wonderland-memes"),
    ("michi", "wonderland-memes"),
    ("moodeng", "wonderland-memes"),
    ("goat", "wonderland-memes"),
    ("pnut", "wonderland-memes"),
    ("pengu", "wonderland-memes"),
    ("neiro", "wonderland-memes"),
    ("fwog", "wonderland-memes"),
    ("useless", "wonderland-memes"),
    ("memecoin", "wonderland-memes"),
    ("meme coin", "wonderland-memes"),
    ("meme token", "wonderland-memes"),
    ("wonderland", "wonderland-memes"),
    ("degen coin", "wonderland-memes"),
    ("low cap gem", "wonderland-memes"),
    ("moonshot", "wonderland-memes"),
    # live signals / discovery
    ("trending", "live-signals"),
    ("whats pumping", "live-signals"),
    ("whats mooning", "live-signals"),
    ("hot solana", "live-signals"),
    ("top gainers", "live-signals"),
    ("volume leaders", "live-signals"),
    ("fresh launch", "live-signals"),
    ("fresh launches", "live-signals"),
    ("new solana", "live-signals"),
    ("signals", "live-signals"),
    ("discovery", "live-signals"),
    ("next 100x", "live-signals"),
    # brand tokens (ticker-specific first, then generic stock terms)
    ("aaplx", "brand-tokens"),
    ("tslax", "brand-tokens"),
    ("nvdax", "brand-tokens"),
    ("msftx", "brand-tokens"),
    ("googlx", "brand-tokens"),
    ("amznx", "brand-tokens"),
    ("metax", "brand-tokens"),
    ("mstrx", "brand-tokens"),
    ("nflxx", "brand-tokens"),
    ("spyx", "brand-tokens"),
    ("qqqx", "brand-tokens"),
    ("crclx", "brand-tokens"),
    ("brand token", "brand-tokens"),
    ("brand tokens", "brand-tokens"),
    ("tokenized stock", "brand-tokens"),
    ("tokenized equity", "brand-tokens"),
    ("stocks on solana", "brand-tokens"),
    ("apple on solana", "brand-tokens"),
    ("tesla on solana", "brand-tokens"),
    ("nvidia on solana", "brand-tokens"),
    ("stock", "brand-tokens"),
    # bridges
    ("bridge", "solana-bridges"),
    ("wormhole", "solana-bridges"),
    ("debridge", "solana-bridges"),
    ("allbridge", "solana-bridges"),
    ("cross chain", "solana-bridges"),
    ("cross-chain", "solana-bridges"),
    ("to solana", "solana-bridges"),
    # whale tracking
    ("whale", "whale-tracking"),
    ("smart money", "whale-tracking"),
    ("top holders", "whale-tracking"),
    ("largest holders", "whale-tracking"),
    ("wallet tracker", "whale-tracking"),
    # token launch
    ("launchpad", "token-launch"),
    ("token launch", "token-launch"),
    ("launch token", "token-launch"),
    ("launch memecoin", "token-launch"),
    ("bonding curve", "token-launch"),
    ("deploy token", "token-launch"),
    ("fair launch", "token-launch"),
    # wallet trading
    ("phantom wallet", "wallet-trading"),
    ("backpack wallet", "wallet-trading"),
    ("solflare wallet", "wallet-trading"),
    ("self custodial", "wallet-trading"),
    ("non custodial", "wallet-trading"),
    ("wallet based", "wallet-trading"),
    ("from wallet", "wallet-trading"),
    # no kyc
    ("no kyc", "no-kyc-trading"),
    ("without kyc", "no-kyc-trading"),
    ("no signup", "no-kyc-trading"),
    ("no account", "no-kyc-trading"),
    ("no verification", "no-kyc-trading"),
    ("anonymous", "no-kyc-trading"),
    ("permissionless", "no-kyc-trading"),
    # swaps (generic, before how-to)
    ("solana swap", "solana-swaps"),
    ("solana dex", "solana-swaps"),
    ("dex aggregator", "solana-swaps"),
    ("best price swap", "solana-swaps"),
    ("swap", "solana-swaps"),
    ("buy", "solana-swaps"),
    # how-to (last)
    ("how to", "how-to-guides"),
]

LOW_VALUE_SINGLE_TERMS = {
    "trade", "swap", "buy", "sell", "mobile", "wallet", "app", "dex",
    "no", "from", "with", "on", "for",
}

HIGH_INTENT_TERMS = {
    "kyc", "wallet", "mobile", "phantom", "backpack", "solflare",
    "whale", "smart", "money", "holders",
    "launch", "launchpad", "bonding", "deploy", "swap", "buy", "sell",
    "trade", "custodial",
    "tokenized", "stocks", "stock", "brand",
    "aaplx", "tslax", "nvdax", "spyx", "qqqx",
    "wonderland", "meme", "memes", "hoppy", "fartcoin", "popcat",
    "bridge", "bridges", "trending", "signals", "fresh",
}


# -----------------------------
# UTILITIES
# -----------------------------
def normalize_keyword(text):
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def slugify(text):
    text = normalize_keyword(text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def contains_term_phrase(haystack, needle):
    haystack_norm = normalize_keyword(haystack)
    needle_norm = normalize_keyword(needle)
    if not haystack_norm or not needle_norm:
        return False
    pattern = r"(^|[^a-z0-9])" + re.escape(needle_norm) + r"([^a-z0-9]|$)"
    return re.search(pattern, haystack_norm, flags=re.IGNORECASE) is not None


def clean_base_keyword(text):
    kw = normalize_keyword(text)
    kw = re.sub(r"^\s*is\s+this\s+", "", kw)
    kw = re.sub(r"^\s*is\s+", "", kw)
    kw = re.sub(r"^\s*can\s+i\s+", "", kw)
    kw = re.sub(r"^\s*should\s+i\s+", "", kw)
    kw = re.sub(r"^\s*how\s+to\s+", "", kw)
    kw = re.sub(r"^\s*where\s+to\s+", "", kw)
    kw = re.sub(r"^\s*best\s+place\s+to\s+", "", kw)
    kw = re.sub(r"\s+no\s+kyc$", "", kw)
    kw = re.sub(r"\s+mobile$", "", kw)
    kw = re.sub(r"\s+app$", "", kw)
    kw = re.sub(r"\s+without\s+kyc$", "", kw)
    return re.sub(r"\s+", " ", kw).strip()


def display_keyword(text):
    return clean_base_keyword(text)


def canonical_keyword(text):
    clean_kw = clean_base_keyword(text)
    return clean_kw if clean_kw else normalize_keyword(text)


def canonical_slug(text):
    return slugify(canonical_keyword(text))


def apply_brand_case(text):
    result = f" {text} "
    for raw, proper in sorted(BRAND_CASE.items(), key=lambda x: len(x[0]), reverse=True):
        pattern = r"(?<![a-z0-9])" + re.escape(raw) + r"(?![a-z0-9])"
        result = re.sub(pattern, proper, result, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", result).strip()


def title_case(text):
    if not text:
        return ""
    words = normalize_keyword(text).split()
    titled = []
    for i, word in enumerate(words):
        if i > 0 and word in SMALL_WORDS:
            titled.append(word)
        else:
            titled.append(word.capitalize())
    return apply_brand_case(" ".join(titled))


def readable_keyword(text):
    base = display_keyword(text)
    return title_case(base) if base else ""


def keyword_tokens(text):
    return set(canonical_keyword(text).split())


def keyword_cluster_tokens(text):
    return {token for token in keyword_tokens(text) if token in NEXUS_DEX_CLUSTER_TERMS}


def keyword_root(text):
    cleaned = canonical_keyword(text)
    return cleaned.split()[0] if cleaned else ""


def escape_html(text):
    return escape(str(text), quote=True)


def is_guidance_style_keyword(keyword):
    kw = normalize_keyword(keyword)
    return (
        kw.startswith("how to ")
        or kw.startswith("what is ")
        or kw.startswith("what does ")
        or kw.startswith("why ")
        or kw.startswith("when ")
        or kw.startswith("where ")
        or kw.startswith("best ")
        or kw.startswith("top ")
        or kw.startswith("cheapest ")
    )


def is_question_style_keyword(keyword):
    kw = normalize_keyword(keyword)
    return kw.startswith(("is ", "can ", "should ", "what ", "why ", "when ", "where "))


def ensure_file(filepath):
    folder = os.path.dirname(filepath)
    if folder:
        os.makedirs(folder, exist_ok=True)
    if not os.path.exists(filepath):
        with open(filepath, "a", encoding="utf-8"):
            pass


def load_keywords():
    if not os.path.exists(KEYWORD_FILE):
        return []
    seen = set()
    ordered = []
    with open(KEYWORD_FILE, encoding="utf-8") as f:
        for line in f:
            keyword = normalize_keyword(line)
            if not keyword or keyword in seen:
                continue
            seen.add(keyword)
            ordered.append(keyword)
    return ordered


def load_generated_slugs():
    if not os.path.exists(GENERATED_SLUGS_FILE):
        return set()
    with open(GENERATED_SLUGS_FILE, encoding="utf-8") as f:
        return {slugify(line) for line in f if slugify(line)}


def load_generated_keywords():
    if not os.path.exists(GENERATED_KEYWORDS_FILE):
        return set()
    with open(GENERATED_KEYWORDS_FILE, encoding="utf-8") as f:
        return {normalize_keyword(line) for line in f if normalize_keyword(line)}


def write_lines(filepath, values):
    ensure_file(filepath)
    lines = [str(v).strip() for v in values if str(v).strip()]
    with open(filepath, "w", encoding="utf-8") as f:
        if lines:
            f.write("\n".join(lines) + "\n")
        else:
            f.write("")


def page_path(slug):
    return os.path.join(OUTPUT_DIR, slug, "index.html")


def page_exists(slug):
    return os.path.exists(page_path(slug))


def humanize_slug(slug):
    return title_case(slug.replace("-", " "))


def validate_template_placeholders(template_html):
    missing = [p for p in REQUIRED_TEMPLATE_PLACEHOLDERS if p not in template_html]
    if missing:
        raise ValueError("Template is missing required placeholders: " + ", ".join(sorted(missing)))


def load_template():
    if not os.path.exists(TEMPLATE_FILE):
        raise FileNotFoundError(f"Missing template file: {TEMPLATE_FILE}")
    with open(TEMPLATE_FILE, encoding="utf-8") as f:
        template = f.read()
    validate_template_placeholders(template)
    return template


def find_best_hub_slug(keyword):
    keyword_norm = normalize_keyword(keyword)
    for term, slug in HUB_MATCH_RULES:
        if contains_term_phrase(keyword_norm, term):
            return slug
    return FALLBACK_HUB_SLUG


def build_hub_link_html(keyword):
    hub_slug = find_best_hub_slug(keyword)
    hub_title = HUB_TITLE_OVERRIDES.get(hub_slug, f"{humanize_slug(hub_slug)} Hub")
    return f'<a href="/{hub_slug}/">{escape_html(hub_title)}</a>'


def sanitize_ai_html(text):
    raw = str(text or "").strip()
    if not raw:
        return ""
    raw = re.sub(r"^```(?:html)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    raw = re.sub(r"<script\b[^>]*>.*?</script>", "", raw, flags=re.IGNORECASE | re.DOTALL)
    raw = re.sub(r"<style\b[^>]*>.*?</style>", "", raw, flags=re.IGNORECASE | re.DOTALL)
    raw = raw.strip()
    if "<" in raw and ">" in raw:
        return raw
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", raw) if p.strip()]
    if not paragraphs:
        paragraphs = [raw]
    return "\n".join(f"<p>{escape_html(p)}</p>" for p in paragraphs)


def build_faq_static_html(meta):
    """
    Render the FAQ as static <details> HTML so the visible Q&A matches the
    {{SCHEMA_FAQ}} JSON-LD and is present without JS (rich-result safe).
    Accepts the common engine key shapes: question/answer, q/a, name/text.
    Returns "" when there's no usable FAQ, in which case the template's inline
    JS falls back to window.__pageMeta.faq.
    """
    faq = (meta or {}).get("faq") or []
    if not isinstance(faq, list):
        return ""
    items = []
    for entry in faq:
        if not isinstance(entry, dict):
            continue
        question = (entry.get("question") or entry.get("q") or entry.get("name") or "").strip()
        answer = (entry.get("answer") or entry.get("a") or entry.get("text") or "").strip()
        if not question or not answer:
            continue
        items.append(
            f"<details><summary>{escape_html(question)}</summary>"
            f'<div class="faq-a">{escape_html(answer)}</div></details>'
        )
    return "\n".join(items)


# -----------------------------
# QUALITY FILTERS
# -----------------------------
def is_weak_keyword(keyword):
    tokens = canonical_keyword(keyword).split()
    if len(tokens) < 2:
        return True
    if len(tokens) == 2 and all(token in LOW_VALUE_SINGLE_TERMS for token in tokens):
        return True
    if not any(token in HIGH_INTENT_TERMS or token in NEXUS_DEX_CLUSTER_TERMS for token in tokens):
        return True
    return False


def keyword_quality_score(keyword):
    kw = normalize_keyword(keyword)
    score = 0
    if "nexus dex" in kw or "verixia" in kw:
        score += 12
    if "no kyc" in kw or "without kyc" in kw or "no signup" in kw:
        score += 10
    if "self custodial" in kw or "non custodial" in kw or "wallet based" in kw:
        score += 8
    if "tokenized stock" in kw or "tokenized equity" in kw or "brand token" in kw:
        score += 10
    if "stocks on solana" in kw or "onchain stocks" in kw:
        score += 8
    if any(tok in kw for tok in ["aaplx", "tslax", "nvdax", "spyx", "qqqx"]):
        score += 6
    if any(term in kw for term in ["btc", "bitcoin", "eth", "ethereum", "sol", "solana"]):
        score += 6
    if any(term in kw for term in ["wif", "bonk", "pepe", "doge", "popcat", "trump", "fartcoin", "hoppy"]):
        score += 7
    if any(term in kw for term in ["swap", "buy", "trade"]):
        score += 5
    if any(term in kw for term in ["phantom", "backpack", "solflare", "wallet"]):
        score += 6
    if "mobile" in kw or "app" in kw:
        score += 4
    if "whale" in kw or "smart money" in kw or "top holders" in kw:
        score += 7
    if "launch" in kw or "launchpad" in kw or "bonding curve" in kw:
        score += 6
    if "bridge" in kw or "wormhole" in kw or "debridge" in kw:
        score += 6
    if "trending" in kw or "signals" in kw or "fresh launch" in kw:
        score += 5
    if kw.startswith("is "):
        score -= 4
    if kw.startswith("can i "):
        score -= 4
    score -= len(kw) / 100.0
    return score


def choose_canonical_keyword(keywords_for_same_intent):
    return sorted(
        keywords_for_same_intent,
        key=lambda k: (-keyword_quality_score(k), len(k), k)
    )[0]


def dedupe_keywords(raw_keywords, already_generated_slugs=None):
    """
    Keyword gate: accept every keyword unless its slug is empty, reserved
    (PROTECTED_SLUGS), already generated, or a duplicate within this batch.
    The SEO engine's own quality floor (is_publishable) is the content gate.
    """
    already_generated_slugs = set(already_generated_slugs or set())

    groups = {}
    for keyword in raw_keywords:
        key = canonical_keyword(keyword)
        groups.setdefault(key, []).append(keyword)

    canonical_keywords = []
    seen_slugs = set()
    skipped_already_generated = 0
    skipped_dup = 0
    deduped = 0

    for _, group in groups.items():
        chosen = choose_canonical_keyword(group)
        chosen_slug = canonical_slug(chosen)

        if not chosen_slug or chosen_slug in PROTECTED_SLUGS:
            continue
        if chosen_slug in already_generated_slugs:
            skipped_already_generated += len(group)
            continue
        if chosen_slug in seen_slugs:
            skipped_dup += len(group)
            continue

        canonical_keywords.append(chosen)
        seen_slugs.add(chosen_slug)
        if len(group) > 1:
            deduped += len(group) - 1

    return canonical_keywords, deduped, skipped_dup, skipped_already_generated


def validate_page_output(slug, title, description, canonical, related_pages):
    errors = []
    if not slug:
        errors.append("empty slug")
    if not canonical.endswith(f"/{slug}/"):
        errors.append("canonical mismatch")
    if len(related_pages) == 0:
        errors.append("no related pages")
    if len(title) < 35 or len(title) > 78:
        errors.append(f"title length {len(title)} out of target range 35-78")
    if len(description) < 110 or len(description) > 170:
        errors.append(f"description length {len(description)} out of target range 110-170")
    return errors


def is_usable_ai_text(text):
    if not text:
        return False
    raw = str(text).strip()
    lowered = raw.lower()
    if len(raw) < 350:
        return False
    weak_markers = {
        "lorem ipsum", "as an ai", "here are some paragraphs",
        "let me know if you want", "i can't help with that",
        "i cannot help with that", "i am sorry", "cannot assist",
        "can't assist", "content policy",
    }
    if any(marker in lowered for marker in weak_markers):
        return False
    paragraph_like = (
        "<p>" in lowered
        or "</p>" in lowered
        or "\n\n" in raw
        or raw.count("\n") >= 3
    )
    return paragraph_like


def append_rejected_keyword(keyword, reason):
    ensure_file(REJECTED_KEYWORDS_FILE)
    entry = f"{normalize_keyword(keyword)} | {str(reason).strip()}"
    existing = set()
    with open(REJECTED_KEYWORDS_FILE, "r", encoding="utf-8") as f:
        existing = {line.strip() for line in f if line.strip()}
    if entry not in existing:
        with open(REJECTED_KEYWORDS_FILE, "a", encoding="utf-8") as f:
            f.write(entry + "\n")


# -----------------------------
# SEO TEXT HELPERS
# -----------------------------
def enforce_title_length(title, fallback):
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


def build_title_fallback(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)
    if not raw:
        return "Verixia | Non-Custodial Swap on Solana, No KYC"
    if is_guidance_style_keyword(raw):
        return f"{title_case(raw)} | Verixia Solana Guide"
    if is_question_style_keyword(raw):
        return f"{title_case(raw)}? Verixia Non-Custodial Trading"
    return f"{readable} | Verixia -- Non-Custodial Swap on Solana"


def build_description_fallback(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)
    clean_kw = display_keyword(keyword)
    if is_guidance_style_keyword(raw) or is_question_style_keyword(raw):
        return (
            f"Use Verixia for {readable}. Non-custodial swaps on Solana from your "
            f"wallet with best-price routing, no KYC, no accounts, and no limits."
        )
    return (
        f"{readable} on Verixia. Non-custodial trading on Solana with best-price "
        f"routing, no KYC, no accounts. Trade {clean_kw} without a centralized exchange."
    )


def build_intro_fallback(keyword):
    readable = readable_keyword(keyword)
    return (
        f"{readable} on Verixia -- a non-custodial swap on Solana. Connect a wallet "
        f"and you're trading. No KYC. No accounts. No limits."
    )


def build_h1_fallback(keyword):
    return readable_keyword(keyword) or "Verixia on Solana"


def build_related_anchor(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)
    if is_guidance_style_keyword(raw) or is_question_style_keyword(raw):
        anchor = title_case(raw)
        if is_question_style_keyword(raw) and not anchor.endswith("?"):
            anchor += "?"
        return anchor
    return f"{readable} on Verixia"


def build_canonical(slug):
    # Pages are served from swap.verixiaapps.com/<slug>/ (same origin as the
    # approved swap dApp), so the canonical lives there.
    return f"{SWAP_SITE}/{slug}/"


# -----------------------------
# CROSS-DOMAIN LINKING (real pages from the token-risk sitemap)
# -----------------------------
_CROSS_SLUGS_CACHE = None

_CROSS_STOPWORDS = {
    "token", "tokens", "crypto", "coin", "coins", "solana", "sol", "the", "a",
    "to", "for", "swap", "risk", "check", "checker", "best", "no", "safe",
    "scam", "how", "is", "buy", "sell", "trade", "trading", "dex", "exchange",
    "defi", "on", "of", "and", "with", "your", "app", "online", "instant",
}


def _cross_slug_tokens(slug):
    return {t for t in slug.split("-") if t and t not in _CROSS_STOPWORDS}


def load_cross_slugs():
    """Fetch the token-risk sitemap once; return [(slug, token_set), ...].
    Returns [] on failure/disabled so callers fall back to hubs."""
    global _CROSS_SLUGS_CACHE
    if _CROSS_SLUGS_CACHE is not None:
        return _CROSS_SLUGS_CACHE
    if not CROSS_SITEMAP_URL:
        _CROSS_SLUGS_CACHE = []
        return _CROSS_SLUGS_CACHE

    result = []
    try:
        import urllib.request
        req = urllib.request.Request(
            CROSS_SITEMAP_URL, headers={"User-Agent": "verixia-seo-crosslink"}
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            xml = resp.read().decode("utf-8", "replace")
        for loc in re.findall(r"<loc>\s*(.*?)\s*</loc>", xml, flags=re.IGNORECASE):
            m = re.search(r"verixiaapps\.com/token-risk/([a-z0-9-]+)/?", loc.strip())
            if not m:
                continue
            s = slugify(m.group(1))
            if s:
                result.append((s, _cross_slug_tokens(s)))
        seen = set()
        deduped = []
        for s, toks in result:
            if s in seen:
                continue
            seen.add(s)
            deduped.append((s, toks))
        _CROSS_SLUGS_CACHE = deduped
        print(f"[crosslink] loaded {len(deduped)} token-risk slugs from sitemap")
    except Exception as e:
        print(f"[crosslink] sitemap fetch failed ({e}); using hub fallback")
        _CROSS_SLUGS_CACHE = []
    return _CROSS_SLUGS_CACHE


def match_cross_slugs(keyword, slug, limit):
    """Pick `limit` real token-risk slugs from the live sitemap for this page.
    No keyword matching -- varied per-page selection, seeded by slug so it's
    stable per page but different across pages."""
    pool = load_cross_slugs()
    if not pool:
        return []
    import random
    rng = random.Random(slug)
    all_slugs = [s for s, _toks in pool]
    if len(all_slugs) <= limit:
        picks = all_slugs[:]
    else:
        picks = rng.sample(all_slugs, limit)
    return [(s, humanize_slug(s)) for s in picks]


def build_token_risk_link_html(slug, keyword):
    """Cross-links to REAL token-risk pages (matched from the live sitemap),
    plus a risk hub as a guaranteed anchor. Never invents a URL."""
    base = "https://verixiaapps.com/token-risk"
    items = []
    seen = set()

    for cand_slug, label in match_cross_slugs(keyword, slug, CROSS_LINKS_PER_PAGE):
        if cand_slug in seen:
            continue
        seen.add(cand_slug)
        items.append(
            f'<li><a href="{base}/{escape_html(cand_slug)}/">'
            f'{escape_html(label)}</a></li>'
        )

    for hub_slug, hub_label in CROSS_RISK_HUBS:
        if hub_slug in seen:
            continue
        items.append(
            f'<li><a href="{base}/{hub_slug}/">{escape_html(hub_label)}</a></li>'
        )
        break

    if len(items) <= 1:
        for hub_slug, hub_label in CROSS_RISK_HUBS:
            if hub_slug in seen:
                continue
            seen.add(hub_slug)
            items.append(
                f'<li><a href="{base}/{hub_slug}/">{escape_html(hub_label)}</a></li>'
            )
            if len(items) >= 4:
                break

    return "\n".join(items)


# -----------------------------
# LINKING HELPERS
# -----------------------------
def dedupe_pages_by_slug(pages_list):
    deduped = []
    seen = set()
    for page in pages_list:
        slug = page["slug"]
        if not slug or slug in seen or slug in PROTECTED_SLUGS:
            continue
        seen.add(slug)
        deduped.append(page)
    return deduped


def get_related_pages(current_page, all_pages, limit, exclude_slugs=None):
    exclude_slugs = set(exclude_slugs or set())
    current_slug = current_page["slug"]
    current_keyword = current_page["keyword"]
    current_tokens = keyword_tokens(current_keyword)
    current_cluster = keyword_cluster_tokens(current_keyword)
    current_root = keyword_root(current_keyword)
    current_hub = find_best_hub_slug(current_keyword)

    candidates = [
        p for p in all_pages
        if p["slug"] != current_slug
        and p["slug"] not in PROTECTED_SLUGS
        and p["slug"] not in exclude_slugs
        and page_exists(p["slug"])
    ]

    def score(page):
        other_keyword = page["keyword"]
        other_tokens = keyword_tokens(other_keyword)
        other_cluster = keyword_cluster_tokens(other_keyword)
        other_root = keyword_root(other_keyword)
        other_hub = find_best_hub_slug(other_keyword)
        length_diff = abs(len(other_keyword.split()) - len(current_keyword.split()))
        same_hub = 1 if current_hub and other_hub == current_hub else 0
        same_root = 1 if current_root and other_root == current_root else 0
        shared_cluster = len(current_cluster & other_cluster)
        shared_tokens = len(current_tokens & other_tokens)
        return (-same_hub, -same_root, -shared_cluster, -shared_tokens, length_diff, other_keyword)

    ranked = sorted(candidates, key=score)
    related = []
    used_slugs = set()

    for page in ranked:
        if page["slug"] in used_slugs:
            continue
        related.append(page)
        used_slugs.add(page["slug"])
        if len(related) == limit:
            break

    return related


def get_more_links(current_page, all_pages, limit, exclude_slugs=None):
    exclude_slugs = set(exclude_slugs or set())
    current_slug = current_page["slug"]
    current_keyword = current_page["keyword"]
    current_hub = find_best_hub_slug(current_keyword)

    same_hub_pages = []
    if current_hub:
        same_hub_pages = [
            p for p in all_pages
            if p["slug"] != current_slug
            and p["slug"] not in exclude_slugs
            and p["slug"] not in PROTECTED_SLUGS
            and page_exists(p["slug"])
            and find_best_hub_slug(p["keyword"]) == current_hub
        ]

    fallback_pages = [
        p for p in all_pages
        if p["slug"] != current_slug
        and p["slug"] not in exclude_slugs
        and p["slug"] not in PROTECTED_SLUGS
        and page_exists(p["slug"])
        and p not in same_hub_pages
    ]

    selected = []
    used_slugs = set()

    for page in same_hub_pages + fallback_pages:
        if page["slug"] in used_slugs:
            continue
        selected.append(page)
        used_slugs.add(page["slug"])
        if len(selected) == limit:
            break

    return selected


def build_links_html(pages_list):
    return "".join(
        f'<li><a href="/{p["slug"]}/">{escape_html(build_related_anchor(p["keyword"]))}</a></li>\n'
        for p in pages_list
        if page_exists(p["slug"])
    )


# -----------------------------
# FULL-PAYLOAD FETCH
# -----------------------------
def ordered_prompt_attempts(keyword, keyword_display):
    attempts = []
    raw_keyword = normalize_keyword(keyword)
    clean_keyword = normalize_keyword(keyword_display)
    readable = readable_keyword(keyword_display)

    if raw_keyword:
        attempts.append(raw_keyword)
    if clean_keyword and clean_keyword != raw_keyword:
        attempts.append(clean_keyword)
    if readable:
        attempts.append(readable)
    if clean_keyword:
        attempts.append(f"{clean_keyword} solana")
    if clean_keyword and not contains_term_phrase(raw_keyword, "kyc"):
        attempts.append(f"{clean_keyword} no kyc")
    if clean_keyword and not contains_term_phrase(raw_keyword, "wallet"):
        attempts.append(f"{clean_keyword} from wallet")

    seen = set()
    ordered = []
    for item in attempts:
        item_norm = normalize_keyword(item)
        if item_norm and item_norm not in seen:
            seen.add(item_norm)
            ordered.append(item)
    return ordered


def fetch_full_payload(keyword, keyword_display):
    last_reason = None
    for attempt in ordered_prompt_attempts(keyword, keyword_display):
        try:
            payload = fetch_seo_page(attempt)
        except Exception as exc:
            last_reason = f"engine error for prompt '{attempt}': {exc}"
            continue

        if not payload:
            last_reason = f"no payload for prompt: {attempt}"
            continue

        ok, reason = is_publishable(payload)
        if not ok:
            last_reason = f"{reason} (prompt: {attempt})"
            continue

        body_html = sanitize_ai_html(payload.get("content", ""))
        if not is_usable_ai_text(body_html):
            last_reason = f"thin/malformed body (prompt: {attempt})"
            continue

        return payload, attempt

    raise ValueError(last_reason or "no publishable payload from engine")


# -----------------------------
# FULL PAGE RENDER
# -----------------------------
def render_full_page(template, keyword, keyword_display, payload, slug,
                     related_pages, more_pages):
    meta    = payload.get("meta") or {}
    content = payload.get("content") or ""

    canonical = build_canonical(slug)

    title = enforce_title_length(meta.get("title"), build_title_fallback(keyword))
    description = (meta.get("description") or "").strip() or build_description_fallback(keyword)
    h1 = (meta.get("h1") or "").strip() or build_h1_fallback(keyword)
    intro = (meta.get("intro") or "").strip() or build_intro_fallback(keyword)
    breadcrumb_name = (meta.get("breadcrumb") or "").strip() or humanize_slug(slug)

    faq_schema = (meta.get("faqSchema") or "").strip() or "{}"
    faq_static_html = build_faq_static_html(meta)

    supp_heading = (meta.get("supplementaryHeading") or "Why Verixia").strip()
    supp_intro   = (meta.get("supplementaryIntro") or "").strip()

    ai_content_html = sanitize_ai_html(content)
    meta_script     = build_page_meta_script(meta)
    modified_date   = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    hub_link_html = build_hub_link_html(keyword)
    related_links_html = build_links_html(related_pages)
    more_links_html    = build_links_html(more_pages)

    substitutions = {
        "{{TITLE}}":                 escape_html(title),
        "{{DESCRIPTION}}":           escape_html(description),
        "{{KEYWORD}}":               escape_html(keyword_display),
        "{{CANONICAL_URL}}":         escape_html(canonical),
        "{{OG_IMAGE}}":              escape_html(OG_IMAGE),
        "{{MODIFIED_DATE}}":         modified_date,
        "{{BREADCRUMB_NAME}}":       escape_html(breadcrumb_name),
        "{{SCHEMA_FAQ}}":            faq_schema,
        "{{FAQ_STATIC}}":            faq_static_html,
        "{{STATIC_H1}}":             escape_html(h1),
        "{{STATIC_INTRO}}":          escape_html(intro),
        "{{HUB_LINK}}":              hub_link_html,
        "{{AI_CONTENT}}":            ai_content_html,
        "{{SUPP_HEADING}}":          escape_html(supp_heading),
        "{{SUPP_INTRO}}":            escape_html(supp_intro),
        "{{RELATED_LINKS}}":         related_links_html,
        "{{MORE_LINKS}}":            more_links_html,
        "{{PAGE_META_SCRIPT}}":      meta_script,
        "{{TOKEN_RISK_LINK}}":       build_token_risk_link_html(slug, keyword),
    }

    html = template
    for placeholder, value in substitutions.items():
        html = html.replace(placeholder, str(value))

    unresolved = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", html)))
    if unresolved:
        raise ValueError(f"unresolved template placeholders: {', '.join(unresolved)}")

    return html, title, description, canonical


# -----------------------------
# SITEMAP
# -----------------------------
def _git_lastmod_for(file_path):
    """Return git-tracked last-commit date for file_path (YYYY-MM-DD), or today UTC."""
    try:
        r = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", file_path],
            capture_output=True, text=True, check=False,
        )
        date_str = (r.stdout or "").strip()
        if date_str:
            return date_str
    except Exception:
        pass
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def rebuild_sitemap():
    """
    Rebuild public/nexus-sitemap.xml by scanning OUTPUT_DIR (public/) on disk.
    Every public/<slug>/index.html present ends up in the sitemap pointing at
    https://swap.verixiaapps.com/<slug>/.
    """
    urls = []
    if os.path.isdir(OUTPUT_DIR):
        for entry in sorted(os.listdir(OUTPUT_DIR)):
            if entry in PROTECTED_SLUGS:
                continue
            dir_path = os.path.join(OUTPUT_DIR, entry)
            index_path = os.path.join(dir_path, "index.html")
            if not os.path.isdir(dir_path) or not os.path.isfile(index_path):
                continue
            lastmod = _git_lastmod_for(index_path)
            urls.append(
                f"<url><loc>{SWAP_SITE}/{entry}/</loc><lastmod>{lastmod}</lastmod></url>"
            )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ("\n".join(urls) + "\n" if urls else "")
        + '</urlset>\n'
    )
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(SITEMAP_FILE, "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"[sitemap] Wrote {len(urls)} URLs to {SITEMAP_FILE}")


# -----------------------------
# GIT CHECKPOINT
# -----------------------------
def get_remaining_keywords(raw_keywords, processed_keywords):
    return [kw for kw in raw_keywords if normalize_keyword(kw) not in processed_keywords]


def git_checkpoint(generated_count, new_generated_keywords, new_generated_slugs, raw_keywords, processed_keywords):
    sorted_keywords = sorted(new_generated_keywords, key=slugify)
    write_lines(GENERATED_KEYWORDS_FILE, sorted_keywords)
    write_lines(GENERATED_SLUGS_FILE, [slugify(k) for k in sorted_keywords])
    write_lines(KEYWORD_FILE, get_remaining_keywords(raw_keywords, processed_keywords))

    rebuild_sitemap()

    try:
        subprocess.run(["git", "add", "-A"], check=True)
        # Never stage anything under .github/ (workflow files). The default
        # GITHUB_TOKEN can't push changes there, so an unrelated workflow file
        # in the repo would otherwise get swept in and reject the whole push.
        subprocess.run(["git", "reset", "-q", "--", ".github"], check=False)
        result = subprocess.run(["git", "diff", "--cached", "--quiet"], capture_output=True)
        if result.returncode == 0:
            print(f"[checkpoint] No changes to commit at {generated_count} pages.")
            return
        subprocess.run(
            ["git", "commit", "-m", f"Nexus DEX checkpoint: {generated_count} pages + sitemap"],
            check=True,
        )
        subprocess.run(["git", "fetch", "origin", "main"], check=True)
        subprocess.run(["git", "push", "--force-with-lease", "origin", "HEAD:main"], check=True)
        print(f"[checkpoint] Committed and pushed at {generated_count} pages (sitemap included).")
    except subprocess.CalledProcessError as e:
        print(f"[checkpoint] Git error at {generated_count} pages: {e}")


# -----------------------------
# MAIN
# -----------------------------
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Rebuild only: catch the workflow's timeout SIGTERM so we can flush a final
    # checkpoint before SIGKILL. Daily incremental runs don't set REBUILD_MODE,
    # so this is a no-op there and their behavior is unchanged.
    if REBUILD_MODE:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)

    ensure_file(GENERATED_SLUGS_FILE)
    ensure_file(GENERATED_KEYWORDS_FILE)
    ensure_file(REJECTED_KEYWORDS_FILE)

    template = load_template()
    raw_keywords = load_keywords()

    if not raw_keywords:
        print("No keywords in queue. Nothing to generate.")
        rebuild_sitemap()
        return 0

    if RESET_ENGINE:
        reset_build_registry()

    generated_slugs = load_generated_slugs()
    generated_keywords = load_generated_keywords()

    keywords, deduped_count, skipped_dup_count, skipped_already_count = dedupe_keywords(
        raw_keywords, already_generated_slugs=generated_slugs,
    )

    queue_pages = []
    seen_queue_slugs = set()
    for keyword in keywords:
        slug = canonical_slug(keyword)
        if not slug or slug in PROTECTED_SLUGS or slug in seen_queue_slugs:
            continue
        seen_queue_slugs.add(slug)
        queue_pages.append({"keyword": keyword, "slug": slug})

    existing_pages = []
    existing_seen_slugs = set()

    for keyword in generated_keywords:
        slug = slugify(keyword)
        if slug in PROTECTED_SLUGS or slug in existing_seen_slugs or not slug:
            continue
        if page_exists(slug):
            existing_pages.append({"keyword": keyword, "slug": slug})
            existing_seen_slugs.add(slug)

    for page in queue_pages:
        if page["slug"] in existing_seen_slugs:
            continue
        if page_exists(page["slug"]):
            existing_pages.append(page)
            existing_seen_slugs.add(page["slug"])

    existing_pages = dedupe_pages_by_slug(existing_pages)
    queue_pages = dedupe_pages_by_slug(queue_pages)

    print(f"Loaded {len(raw_keywords)} raw keywords from queue.")
    print(f"Canonical keywords after dedupe: {len(keywords)}")
    print(f"Duplicate / fragmented keywords removed: {deduped_count}")
    print(f"Duplicate slug groups skipped: {skipped_dup_count}")
    print(f"Already-generated slug groups skipped: {skipped_already_count}")
    print(f"Known generated slugs: {len(generated_slugs)}")
    print(f"Known generated keywords: {len(generated_keywords)}")
    print(f"Existing pages available for internal links: {len(existing_pages)}")
    print(f"Daily limit: {DAILY_LIMIT}")
    print(f"Commit every: {COMMIT_EVERY}")
    print(f"Resume mode: {RESUME}")
    print(f"Reset engine registries: {RESET_ENGINE}")
    print(f"Rebuild mode (graceful timeout): {REBUILD_MODE}")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Sitemap file: {SITEMAP_FILE}")
    print(f"Canonical base: {SWAP_SITE}")

    generated_count = 0
    skipped_existing_count = 0
    ai_failure_count = 0
    validation_error_count = 0
    processed_keywords = set()
    new_generated_slugs = set(generated_slugs)
    new_generated_keywords = set(generated_keywords)

    for page in queue_pages:
        # Rebuild only: a timeout SIGTERM sets this. Stop after the current page
        # so the end-of-run git_checkpoint() below commits + pushes everything
        # built so far; the resume run picks up the untouched remainder.
        if _STOP_REQUESTED:
            print("[shutdown] SIGTERM received -- flushing final checkpoint and exiting")
            break

        if generated_count >= DAILY_LIMIT:
            break

        slug = page["slug"]
        keyword = page["keyword"]
        keyword_norm = normalize_keyword(keyword)
        keyword_display = display_keyword(keyword)
        path = page_path(slug)

        if slug in PROTECTED_SLUGS:
            processed_keywords.add(keyword_norm)
            print("Skipping protected page:", slug)
            continue

        if page_exists(slug) and RESUME:
            skipped_existing_count += 1
            new_generated_slugs.add(slug)
            new_generated_keywords.add(keyword)
            processed_keywords.add(keyword_norm)
            continue

        os.makedirs(os.path.dirname(path), exist_ok=True)

        try:
            payload, used_prompt = fetch_full_payload(keyword, keyword_display)
        except Exception as e:
            ai_failure_count += 1
            append_rejected_keyword(keyword, e)
            print(f"REJECTED {keyword}: {e}")
            continue

        related_pages = get_related_pages(page, existing_pages, RELATED_LINKS_COUNT)
        related_slugs = {p["slug"] for p in related_pages}
        more_pages = get_more_links(page, existing_pages, MORE_LINKS_COUNT, exclude_slugs=related_slugs)

        try:
            html, title, description, canonical = render_full_page(
                template, keyword, keyword_display, payload, slug, related_pages, more_pages
            )
        except ValueError as e:
            ai_failure_count += 1
            append_rejected_keyword(keyword, f"render error: {e}")
            print(f"REJECTED {keyword}: render error: {e}")
            continue

        validation_errors = validate_page_output(slug, title, description, canonical, related_pages)
        if validation_errors:
            validation_error_count += 1
            print(f"Validation warning for {slug}: {'; '.join(validation_errors)}")

        with open(path, "w", encoding="utf-8") as f:
            f.write(html)

        new_generated_slugs.add(slug)
        new_generated_keywords.add(keyword)
        processed_keywords.add(keyword_norm)

        existing_pages.append({"keyword": keyword, "slug": slug})
        existing_pages = dedupe_pages_by_slug(existing_pages)
        generated_count += 1

        meta = payload.get("meta") or {}
        print(
            f"Generated: {slug} ({generated_count}/{DAILY_LIMIT}) "
            f"-> hub: {find_best_hub_slug(keyword)} "
            f"score={payload.get('score', meta.get('score'))} "
            f"intent={meta.get('intent')} prompt={used_prompt!r}"
        )

        if generated_count % COMMIT_EVERY == 0:
            git_checkpoint(generated_count, new_generated_keywords, new_generated_slugs, raw_keywords, processed_keywords)

    git_checkpoint(generated_count, new_generated_keywords, new_generated_slugs, raw_keywords, processed_keywords)

    remaining_count = len(get_remaining_keywords(raw_keywords, processed_keywords))

    print("\n--- NEXUS DEX SEO BUILD REPORT ---")
    print(f"Raw keywords loaded: {len(raw_keywords)}")
    print(f"Canonical keywords used: {len(keywords)}")
    print(f"Duplicate / fragmented keywords removed: {deduped_count}")
    print(f"Duplicate slug groups skipped: {skipped_dup_count}")
    print(f"Already-generated slug groups skipped: {skipped_already_count}")
    print(f"Pages generated: {generated_count}")
    print(f"Pages skipped (already on disk): {skipped_existing_count}")
    print(f"Rejected (below floor / engine fail / render): {ai_failure_count}")
    print(f"Validation warnings: {validation_error_count}")
    print(f"Remaining keywords in queue: {remaining_count}")

    try:
        report = fetch_build_report()
        if report:
            print(f"Engine build report: {json.dumps(report.get('scoreSummary', {}), ensure_ascii=False)}")
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
