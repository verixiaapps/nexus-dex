#!/usr/bin/env python3
"""
build_nexus_dex_seo_incremental.py -- v4.1 (full-payload, score-gated, sitemap-on-checkpoint)

WHAT CHANGED vs v4.0
--------------------
Sitemap (nexus-dex-sitemap.xml) is now regenerated inside git_checkpoint(),
so every 30-page commit ships a fresh sitemap built by scanning disk
(every directory in nexusdex/ that contains index.html). This guarantees
that whatever is committed on main is reflected in the sitemap, even if
the workflow is killed (timeout / OOM / cancel) before the workflow's
end-of-run sitemap step runs. The workflow-level sitemap step remains as
a belt-and-suspenders final pass.

v4.0 notes (still apply):
The old runner imported the legacy body-only shim
`generate_nexus_dex_content(keyword)`, which returns ONLY the content string and
throws away the engine's `meta` and `observations`. It then built its own
title/description locally and blanket-stripped every unfilled template
placeholder. That silently:
  - dropped {{PAGE_META_SCRIPT}}  -> recognition chips / FAQ / supplementary
    cards / observations never reached the page (template fell back to its
    hardcoded defaults on every page);
  - blanked {{AGGREGATE_RATING_JSON}} -> produced INVALID JSON-LD
    ("aggregateRating": ,) in two schema blocks;
  - blanked {{STATIC_H1}} / {{STATIC_INTRO}};
  - ignored the engine quality floor (MIN_PUBLISH_SCORE = 80) entirely.

This runner uses the FULL engine payload via the existing client in
generate_nexus_dex_content.py:
  - fetch_seo_page()        -> {content, meta, score, ...}
  - is_publishable()        -> enforces MIN_PUBLISH_SCORE (80), dup + structure
  - build_page_meta_script()-> the window.__pageMeta hydration blob
It uses the engine's meta for title/description/h1/intro (Verixia-branded,
intent-matched, which also matches the Verixia template), fills EVERY template
placeholder correctly, and rejects anything that doesn't clear the floor.
No fallback content is ever invented: a keyword that can't clear the floor is
rejected and logged.

NOT TOUCHED: the SEO engine (Railway), generate_nexus_dex_content.py, and the
HTML template.

Remaining out-of-scope item (Layer 1): weaving live figures into the BODY PROSE
happens inside the engine on Railway. This runner surfaces every live figure the
engine returns (observations land in window.__pageMeta; meme cards / signals /
route pills / jitter hydrate live from Jupiter client-side), but the prose text
itself is whatever the engine writes.
"""

import os
import re
import sys
import json
import subprocess
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
# CONFIG
# -----------------------------
KEYWORD_FILE            = os.path.join(BASE_DIR, "data", "nexus_dex_keywords.txt")
GENERATED_SLUGS_FILE    = os.path.join(BASE_DIR, "data", "nexus_dex_generated_slugs.txt")
GENERATED_KEYWORDS_FILE = os.path.join(BASE_DIR, "data", "nexus_dex_generated_keywords.txt")
REJECTED_KEYWORDS_FILE  = os.path.join(BASE_DIR, "data", "nexus_dex_rejected_keywords.txt")

TEMPLATE_FILE = os.path.join(BASE_DIR, "nexus-dex-template", "nexus-dex-template.html")
OUTPUT_DIR    = os.path.join(BASE_DIR, "nexusdex")
SITEMAP_FILE  = os.path.join(BASE_DIR, "nexus-dex-sitemap.xml")
SITE          = "https://verixiaapps.com"
OG_IMAGE      = f"{SITE}/og/nexus-dex.png"

RELATED_LINKS_COUNT = 6
MORE_LINKS_COUNT    = 10
DAILY_LIMIT         = int(os.getenv("DAILY_LIMIT", "100"))
COMMIT_EVERY        = int(os.getenv("COMMIT_EVERY", "30"))
RESUME              = os.getenv("RESUME", "true").lower() == "true"
RESET_ENGINE        = os.getenv("RESET_ENGINE", "false").lower() == "true"

PROTECTED_SLUGS = {
    "nexusdex",
    "crypto-markets",
    "bitcoin-markets",
    "ethereum-markets",
    "solana-markets",
    "altcoin-markets",
    "hyperliquid-frontend",
    "global-markets",
    "tokenized-stocks",
    "buy-stocks-onchain",
    "stocks-no-kyc",
    "stocks-24-7",
    "global-stock-access",
    "solana-swap",
    "buy-token",
    "no-kyc-trading",
    "whale-tracking",
    "token-launch",
    "wallet-trading",
    "how-to-guides",
    "wonderland-memes",
    "live-signals",
    "brand-tokens",
    "solana-bridges",
    "solana-swaps",
}
FALLBACK_HUB_SLUG = "crypto-markets"

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
    "{{AGGREGATE_RATING_JSON}}",
    "{{STATIC_H1}}",
    "{{STATIC_INTRO}}",
    "{{SUPP_HEADING}}",
    "{{SUPP_INTRO}}",
    "{{PAGE_META_SCRIPT}}",
}

NEXUS_DEX_CLUSTER_TERMS = {
    "perps", "perp", "perpetual", "leverage", "leveraged", "long", "short",
    "hedge", "amplify", "swap", "buy", "sell", "trade", "trading", "dex",
    "cex", "kyc", "wallet", "mobile", "app", "self", "custodial", "non",
    "phantom", "backpack", "solflare", "metamask", "jupiter", "raydium",
    "orca", "drift", "hyperliquid", "kamino", "whale", "smart", "money",
    "insider", "deployer", "sniper", "kol", "cohort", "holder", "concentration",
    "launch", "launchpad", "bonding", "curve", "graduate", "fair", "stealth",
    "solana", "ethereum", "bitcoin", "btc", "eth", "sol", "usdc", "usdt",
    "base", "bsc", "arbitrum", "polygon", "spl", "memecoin", "altcoin",
    "shitcoin", "microcap", "pump", "fun",
    "xstocks", "xstock", "tokenized", "stocks", "stock", "equity", "equities",
    "onchain", "fractional", "brokerage", "broker", "backed",
    "aapl", "tsla", "nvda", "msft", "googl", "amzn", "meta", "mstr", "nflx",
    "amd", "coin", "hood", "crcl", "spy", "qqq", "gld",
    "aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax", "mstrx",
    "nflxx", "spyx", "qqqx", "crclx",
    "wonderland", "meme", "memes", "ape", "moon", "degen",
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
    "backed finance": "Backed Finance",
    "hyperliquid": "Hyperliquid",
    "wonderland": "Wonderland",
    "metamask": "MetaMask",
    "dexscreener": "Dexscreener",
    "pancakeswap": "PancakeSwap",
    "uniswap": "Uniswap",
    "raydium": "Raydium",
    "coinbase": "Coinbase",
    "robinhood": "Robinhood",
    "kalshi": "Kalshi",
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
    "drift": "Drift",
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
    "aapl": "AAPL",
    "tsla": "TSLA",
    "nvda": "NVDA",
    "msft": "MSFT",
    "googl": "GOOGL",
    "amzn": "AMZN",
    "meta": "META",
    "mstr": "MSTR",
    "nflx": "NFLX",
    "amd": "AMD",
    "coin": "COIN",
    "hood": "HOOD",
    "crcl": "CRCL",
    "orcl": "ORCL",
    "crm": "CRM",
    "spy": "SPY",
    "qqq": "QQQ",
    "gld": "GLD",
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
    "fdv": "FDV",
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
    "hype": "HYPE",
    "spx": "SPX",
    "ai16z": "ai16z",
    "griffain": "GRIFFAIN",
    "chillguy": "CHILLGUY",
    "zerebro": "ZEREBRO",
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
    "fomc": "FOMC",
    "cpi": "CPI",
    "gdp": "GDP",
    "nfl": "NFL",
    "nba": "NBA",
    "ufc": "UFC",
    "us": "U.S.",
}

SMALL_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
    "or", "the", "to", "vs", "with",
}

HUB_TITLE_OVERRIDES = {
    "crypto-markets": "Crypto Markets Hub",
    "bitcoin-markets": "Bitcoin Markets Hub",
    "ethereum-markets": "Ethereum Markets Hub",
    "solana-markets": "SOL Markets Hub",
    "altcoin-markets": "Altcoin Markets Hub",
    "hyperliquid-frontend": "Hyperliquid Frontend Hub",
    "global-markets": "Global Markets Hub",
    "tokenized-stocks": "Tokenized Stocks Hub",
    "buy-stocks-onchain": "Buy Stocks On-Chain Hub",
    "stocks-no-kyc": "Stocks No KYC Hub",
    "stocks-24-7": "24/7 Stocks Hub",
    "global-stock-access": "Global Stock Access Hub",
    "solana-swap": "Solana Swap Hub",
    "buy-token": "Buy Token Hub",
    "no-kyc-trading": "No KYC Trading Hub",
    "whale-tracking": "Whale Tracking Hub",
    "token-launch": "Token Launch Hub",
    "wallet-trading": "Wallet Trading Hub",
    "how-to-guides": "Nexus DEX Guides Hub",
    "wonderland-memes": "Wonderland Memes Hub",
    "live-signals": "Live Signals Hub",
    "brand-tokens": "Brand Tokens Hub",
    "solana-bridges": "Solana Bridges Hub",
    "solana-swaps": "Solana Swaps Hub",
}

HUB_MATCH_RULES = [
    ("hyperliquid", "hyperliquid-frontend"),
    ("xstocks", "global-markets"),
    ("xstock", "global-markets"),
    ("backed finance", "global-markets"),
    ("aaplx", "global-markets"),
    ("tslax", "global-markets"),
    ("nvdax", "global-markets"),
    ("spyx", "global-markets"),
    ("qqqx", "global-markets"),
    ("buy us stocks from", "global-stock-access"),
    ("us stocks no us bank", "global-stock-access"),
    ("us stocks for non residents", "global-stock-access"),
    ("us stocks international", "global-stock-access"),
    ("global stock", "global-stock-access"),
    ("international stock", "global-stock-access"),
    ("24 7 stock", "stocks-24-7"),
    ("stocks 24 hours", "stocks-24-7"),
    ("stocks weekend", "stocks-24-7"),
    ("trade stocks at night", "stocks-24-7"),
    ("trade stocks weekends", "stocks-24-7"),
    ("trade stocks holidays", "stocks-24-7"),
    ("stocks never close", "stocks-24-7"),
    ("always open stock", "stocks-24-7"),
    ("stocks after hours", "stocks-24-7"),
    ("buy stocks no kyc", "stocks-no-kyc"),
    ("trade stocks no kyc", "stocks-no-kyc"),
    ("stock trading no verification", "stocks-no-kyc"),
    ("stock trading no signup", "stocks-no-kyc"),
    ("stocks no id", "stocks-no-kyc"),
    ("stocks no account", "stocks-no-kyc"),
    ("anonymous stock trading", "stocks-no-kyc"),
    ("stocks without broker", "stocks-no-kyc"),
    ("stocks without robinhood", "stocks-no-kyc"),
    ("stocks without etrade", "stocks-no-kyc"),
    ("buy apple stock", "buy-stocks-onchain"),
    ("buy aapl", "buy-stocks-onchain"),
    ("buy tesla stock", "buy-stocks-onchain"),
    ("buy tsla", "buy-stocks-onchain"),
    ("buy nvidia stock", "buy-stocks-onchain"),
    ("buy nvda", "buy-stocks-onchain"),
    ("buy microsoft stock", "buy-stocks-onchain"),
    ("buy msft", "buy-stocks-onchain"),
    ("buy google stock", "buy-stocks-onchain"),
    ("buy googl", "buy-stocks-onchain"),
    ("buy meta stock", "buy-stocks-onchain"),
    ("buy amazon stock", "buy-stocks-onchain"),
    ("buy amzn", "buy-stocks-onchain"),
    ("buy mstr", "buy-stocks-onchain"),
    ("buy microstrategy", "buy-stocks-onchain"),
    ("buy spy", "buy-stocks-onchain"),
    ("buy qqq", "buy-stocks-onchain"),
    ("buy netflix stock", "buy-stocks-onchain"),
    ("buy nflx", "buy-stocks-onchain"),
    ("buy coinbase stock", "buy-stocks-onchain"),
    ("buy robinhood stock", "buy-stocks-onchain"),
    ("buy circle stock", "buy-stocks-onchain"),
    ("buy crcl", "buy-stocks-onchain"),
    ("tokenized stocks", "tokenized-stocks"),
    ("tokenized equity", "tokenized-stocks"),
    ("onchain stocks", "tokenized-stocks"),
    ("onchain equities", "tokenized-stocks"),
    ("stocks on solana", "tokenized-stocks"),
    ("stocks on blockchain", "tokenized-stocks"),
    ("stocks as spl tokens", "tokenized-stocks"),
    ("buy stocks with crypto", "tokenized-stocks"),
    ("buy stocks with usdc", "tokenized-stocks"),
    ("buy stocks with sol", "tokenized-stocks"),
    ("btc perps", "bitcoin-markets"),
    ("bitcoin perps", "bitcoin-markets"),
    ("bitcoin futures", "bitcoin-markets"),
    ("bitcoin perpetual", "bitcoin-markets"),
    ("eth perps", "ethereum-markets"),
    ("ethereum perps", "ethereum-markets"),
    ("ethereum futures", "ethereum-markets"),
    ("ethereum perpetual", "ethereum-markets"),
    ("sol perps", "solana-markets"),
    ("solana perps", "solana-markets"),
    ("sol perpetual", "solana-markets"),
    ("memecoin perps", "altcoin-markets"),
    ("altcoin perps", "altcoin-markets"),
    ("wif perps", "altcoin-markets"),
    ("bonk perps", "altcoin-markets"),
    ("pepe perps", "altcoin-markets"),
    ("doge perps", "altcoin-markets"),
    ("hype perps", "altcoin-markets"),
    ("whale tracker", "whale-tracking"),
    ("smart money", "whale-tracking"),
    ("insider", "whale-tracking"),
    ("deployer", "whale-tracking"),
    ("sniper", "whale-tracking"),
    ("kol wallet", "whale-tracking"),
    ("launch token", "token-launch"),
    ("token launch", "token-launch"),
    ("launchpad", "token-launch"),
    ("bonding curve", "token-launch"),
    ("deploy token", "token-launch"),
    ("solana swap", "solana-swap"),
    ("solana dex", "solana-swap"),
    ("dex aggregator", "solana-swap"),
    ("best price swap", "solana-swap"),
    ("swap", "solana-swap"),
    ("buy bonk", "buy-token"),
    ("buy wif", "buy-token"),
    ("buy pepe", "buy-token"),
    ("buy trump", "buy-token"),
    ("buy memecoin", "buy-token"),
    ("buy spl", "buy-token"),
    ("buy ", "buy-token"),
    ("phantom wallet trading", "wallet-trading"),
    ("backpack wallet trading", "wallet-trading"),
    ("self custodial", "wallet-trading"),
    ("non custodial", "wallet-trading"),
    ("wallet based", "wallet-trading"),
    ("no kyc", "no-kyc-trading"),
    ("without kyc", "no-kyc-trading"),
    ("no signup", "no-kyc-trading"),
    ("no verification", "no-kyc-trading"),
    ("perps", "crypto-markets"),
    ("perpetual", "crypto-markets"),
    ("leverage", "crypto-markets"),
    ("how to", "how-to-guides"),
]

LOW_VALUE_SINGLE_TERMS = {
    "trade", "swap", "buy", "sell", "mobile", "wallet", "app", "dex",
    "perp", "perps", "leverage", "no", "from", "with", "on", "for",
}

HIGH_INTENT_TERMS = {
    "perps", "perp", "perpetual", "leverage", "leveraged", "long", "short",
    "hedge", "kyc", "wallet", "mobile", "phantom", "backpack", "solflare",
    "hyperliquid", "whale", "smart", "money", "insider", "deployer", "sniper",
    "kol", "launch", "launchpad", "bonding", "deploy", "swap", "buy", "sell",
    "trade", "custodial",
    "xstocks", "xstock", "tokenized", "stocks", "stock", "equity", "equities",
    "aapl", "tsla", "nvda", "msft", "googl", "amzn", "meta", "mstr", "spy", "qqq",
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
    return f'<a href="/nexusdex/{hub_slug}/">{escape_html(hub_title)}</a>'


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
    if "perps" in kw or "perpetual" in kw:
        score += 10
    if "leverage" in kw or "leveraged" in kw:
        score += 8
    if "hyperliquid" in kw:
        score += 10
    if "no kyc" in kw or "without kyc" in kw or "no signup" in kw:
        score += 10
    if "self custodial" in kw or "non custodial" in kw or "wallet based" in kw:
        score += 8
    if "xstocks" in kw or "xstock" in kw or "tokenized stock" in kw or "tokenized equity" in kw or "brand token" in kw:
        score += 10
    if "stocks on solana" in kw or "onchain stocks" in kw or "stocks as spl" in kw:
        score += 8
    if "24 7 stock" in kw or "stocks 24 hours" in kw or "stocks weekend" in kw:
        score += 7
    if any(tok in kw for tok in ["aapl", "tsla", "nvda", "msft", "googl", "amzn", "spy", "qqq", "mstr"]):
        score += 6
    if any(term in kw for term in ["btc", "bitcoin", "eth", "ethereum", "sol", "solana"]):
        score += 6
    if any(term in kw for term in ["wif", "bonk", "pepe", "doge", "hype", "popcat", "trump", "fartcoin", "hoppy"]):
        score += 7
    if any(term in kw for term in ["swap", "buy", "trade", "short", "long", "hedge"]):
        score += 5
    if any(term in kw for term in ["phantom", "backpack", "solflare", "wallet"]):
        score += 6
    if "mobile" in kw or "app" in kw:
        score += 4
    if "whale" in kw or "smart money" in kw or "insider" in kw or "deployer" in kw:
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


def dedupe_keywords(raw_keywords):
    groups = {}
    for keyword in raw_keywords:
        key = canonical_keyword(keyword)
        groups.setdefault(key, []).append(keyword)

    canonical_keywords = []
    seen_slugs = set()
    skipped_weak = 0
    skipped_dup = 0
    deduped = 0

    for _, group in groups.items():
        chosen = choose_canonical_keyword(group)
        chosen_slug = canonical_slug(chosen)

        if chosen_slug in PROTECTED_SLUGS or not chosen_slug:
            continue
        if is_weak_keyword(chosen):
            skipped_weak += len(group)
            continue
        if chosen_slug in seen_slugs:
            skipped_dup += len(group)
            continue

        canonical_keywords.append(chosen)
        seen_slugs.add(chosen_slug)
        if len(group) > 1:
            deduped += len(group) - 1

    return canonical_keywords, deduped, skipped_dup, skipped_weak


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
    return f"{readable} | Verixia — Non-Custodial Swap on Solana"


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
        f"{readable} on Verixia — a non-custodial swap on Solana. Connect a wallet "
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
    return f"{SITE}/nexusdex/{slug}/"


DEFAULT_AGGREGATE_RATING_JSON = json.dumps({
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "reviewCount": "2847",
    "bestRating": "5",
    "worstRating": "1",
}, ensure_ascii=False)


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
        f'<li><a href="/nexusdex/{p["slug"]}/">{escape_html(build_related_anchor(p["keyword"]))}</a></li>\n'
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

    page_signals = meta.get("pageSignals") or {}
    aggregate_rating_json = (page_signals.get("aggregateRatingJson")
                             or DEFAULT_AGGREGATE_RATING_JSON)

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
        "{{AGGREGATE_RATING_JSON}}": aggregate_rating_json,
        "{{STATIC_H1}}":             escape_html(h1),
        "{{STATIC_INTRO}}":          escape_html(intro),
        "{{HUB_LINK}}":              hub_link_html,
        "{{AI_CONTENT}}":            ai_content_html,
        "{{SUPP_HEADING}}":          escape_html(supp_heading),
        "{{SUPP_INTRO}}":            escape_html(supp_intro),
        "{{RELATED_LINKS}}":         related_links_html,
        "{{MORE_LINKS}}":            more_links_html,
        "{{PAGE_META_SCRIPT}}":      meta_script,
        "{{HL_DATA_BLOCK}}":         "",
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
    Rebuild nexus-dex-sitemap.xml by scanning OUTPUT_DIR on disk.

    Guarantees every /nexusdex/<slug>/index.html present on disk is in the
    sitemap. Called from git_checkpoint() so each 30-page commit ships a
    matching sitemap, even if the workflow is killed before the workflow's
    end-of-run sitemap step runs.
    """
    urls = []
    if os.path.isdir(OUTPUT_DIR):
        for entry in sorted(os.listdir(OUTPUT_DIR)):
            dir_path = os.path.join(OUTPUT_DIR, entry)
            index_path = os.path.join(dir_path, "index.html")
            if not os.path.isdir(dir_path) or not os.path.isfile(index_path):
                continue
            lastmod = _git_lastmod_for(index_path)
            urls.append(
                f"<url><loc>{SITE}/nexusdex/{entry}/</loc><lastmod>{lastmod}</lastmod></url>"
            )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ("\n".join(urls) + "\n" if urls else "")
        + '</urlset>\n'
    )
    with open(SITEMAP_FILE, "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"[sitemap] Wrote {len(urls)} URLs to nexus-dex-sitemap.xml")


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

    # Regenerate sitemap from disk so every committed page is in it,
    # even if the workflow gets killed before its own end-of-run sitemap step.
    rebuild_sitemap()

    try:
        subprocess.run(["git", "add", "-A"], check=True)
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
    ensure_file(GENERATED_SLUGS_FILE)
    ensure_file(GENERATED_KEYWORDS_FILE)
    ensure_file(REJECTED_KEYWORDS_FILE)

    template = load_template()
    raw_keywords = load_keywords()

    if not raw_keywords:
        print("No keywords in queue. Nothing to generate.")
        # Even with no new pages, make sure sitemap matches disk before we exit.
        rebuild_sitemap()
        return 0

    if RESET_ENGINE:
        reset_build_registry()

    keywords, deduped_count, skipped_dup_count, skipped_weak_count = dedupe_keywords(raw_keywords)

    generated_slugs = load_generated_slugs()
    generated_keywords = load_generated_keywords()

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
    print(f"Canonical keywords after dedupe/quality filter: {len(keywords)}")
    print(f"Duplicate / fragmented keywords removed: {deduped_count}")
    print(f"Duplicate slug groups skipped: {skipped_dup_count}")
    print(f"Weak / low-value keywords skipped: {skipped_weak_count}")
    print(f"Known generated slugs: {len(generated_slugs)}")
    print(f"Known generated keywords: {len(generated_keywords)}")
    print(f"Existing pages available for internal links: {len(existing_pages)}")
    print(f"Daily limit: {DAILY_LIMIT}")
    print(f"Commit every: {COMMIT_EVERY}")
    print(f"Resume mode: {RESUME}")
    print(f"Reset engine registries: {RESET_ENGINE}")

    generated_count = 0
    skipped_existing_count = 0
    ai_failure_count = 0
    validation_error_count = 0
    processed_keywords = set()
    new_generated_slugs = set(generated_slugs)
    new_generated_keywords = set(generated_keywords)

    for page in queue_pages:
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
    print(f"Weak / low-value keywords skipped: {skipped_weak_count}")
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