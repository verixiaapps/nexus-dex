import os
import re
import sys
import json
from collections import Counter

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

from data.nexus_dex_clusters import CLUSTERS

KEYWORDS_FILE = os.path.join(BASE_DIR, "data", "nexus_dex_keywords.txt")
OUTPUT_DIR = os.path.join(BASE_DIR, "defi")
SITE = "https://verixiaapps.com"

MAX_LINKS_PER_HUB = 50

REPORT_PATH = os.path.join(OUTPUT_DIR, "_nexus_dex_hub_build_report.json")

PROTECTED_HUB_SLUGS = set(CLUSTERS.keys())

# Brand casing fixes for titles
BRAND_CASE = {
    "xstocks": "xStocks",
    "dex": "DEX",
    "kyc": "KYC",
    "btc": "BTC",
    "eth": "ETH",
    "sol": "SOL",
    "spl": "SPL",
    "us": "U.S.",
    "24": "24",
    "7": "7",
    "aapl": "AAPL",
    "tsla": "TSLA",
    "nvda": "NVDA",
    "spy": "SPY",
    "qqq": "QQQ",
}

# Per-hub titles (richer SEO than generic)
HUB_TITLES = {
    "crypto-markets": "Perps Trading on Nexus DEX: Leverage, No KYC, Wallet-Based",
    "bitcoin-markets": "Bitcoin Perps: Long, Short & Leverage BTC From Your Wallet",
    "ethereum-markets": "Ethereum Perps: Long, Short & Leverage ETH From Your Wallet",
    "solana-markets": "SOL Perps: Solana Leverage Trading From Your Wallet",
    "altcoin-markets": "Altcoin & Memecoin Perps: WIF, BONK, PEPE Leverage",
    "hyperliquid-frontend": "Trade Hyperliquid From Solana: No MetaMask, No Bridge",
    "global-markets": "xStocks on Nexus DEX: Trade AAPL, TSLA, NVDA From Your Wallet",
    "tokenized-stocks": "Tokenized Stocks on Solana: Apple, Tesla, Nvidia On-Chain",
    "buy-stocks-onchain": "Buy Apple, Tesla, Nvidia & More On Solana: xStocks From Wallet",
    "stocks-no-kyc": "Buy U.S. Stocks With No KYC: xStocks From a Solana Wallet",
    "stocks-24-7": "Trade Stocks 24/7 On-Chain: Weekends, After Hours, No Close",
    "global-stock-access": "Buy U.S. Stocks Globally: xStocks From Europe, Asia, LATAM",
    "solana-swap": "Solana DEX Aggregator: Best Price Swaps, No KYC, Mobile",
    "buy-token": "Buy Solana Tokens: Memecoins & New Launches From Wallet",
    "no-kyc-trading": "No KYC Trading: Perps, Swaps, Stocks From Your Wallet",
    "whale-tracking": "Solana Whale Tracking: Smart Money, Insiders & Early Buyers",
    "token-launch": "Launch a Solana Token: No KYC, From Your Wallet, Mobile",
    "wallet-trading": "Wallet-Based Trading: Self-Custodial Perps, Swaps & Stocks",
    "how-to-guides": "Nexus DEX How-To Guides: Trading, Stocks, Launching",
}

# Per-hub meta descriptions
HUB_META_DESCRIPTIONS = {
    "crypto-markets": "Trade crypto perps with leverage on Nexus DEX. No KYC, no signup, no centralized account. Long or short BTC, ETH, SOL, and altcoins from your wallet.",
    "bitcoin-markets": "Long or short Bitcoin with leverage on Nexus DEX. Trade BTC perpetuals from a Solana wallet with no KYC, no account, and mobile-first access.",
    "ethereum-markets": "Long or short Ethereum with leverage on Nexus DEX. Trade ETH perpetuals from your Solana wallet with no MetaMask, no account, no KYC.",
    "solana-markets": "Long or short SOL with leverage on Nexus DEX. Trade Solana perpetuals from the same wallet you use for spot, with no off-chain account.",
    "altcoin-markets": "Trade altcoin and memecoin perps on Nexus DEX: WIF, BONK, PEPE, HYPE. Leverage from your wallet, no KYC, no signup, mobile-first.",
    "hyperliquid-frontend": "Use Hyperliquid from a Solana wallet on Nexus DEX. Mobile-first, no MetaMask, no Arbitrum bridge. Trade Hyperliquid perps from Phantom.",
    "global-markets": "Trade tokenized U.S. stocks on Nexus DEX from a Solana wallet. AAPLx, TSLAx, NVDAx, SPYx 24/7 with no brokerage account, no KYC at protocol level.",
    "tokenized-stocks": "Trade tokenized stocks on Solana from your wallet. Apple, Tesla, Nvidia, S&P 500 as SPL tokens with 24/7 trading and no brokerage account.",
    "buy-stocks-onchain": "Buy AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, SPY, QQQ on Solana as xStocks. Wallet-based, 24/7, no broker, fractional, DeFi composable.",
    "stocks-no-kyc": "Buy U.S. stocks with no KYC, no broker signup, and no ID check. xStocks on Solana trade as SPL tokens from Phantom, Backpack, Solflare.",
    "stocks-24-7": "Trade tokenized U.S. stocks 24/7 on Solana. AAPLx, TSLAx, NVDAx, SPYx never close — trade weekends, after hours, holidays from your wallet.",
    "global-stock-access": "Buy U.S. stocks from Europe, Asia, India, LATAM, Africa via xStocks on Solana. No U.S. bank, no broker, no KYC. Just a wallet and USDC.",
    "solana-swap": "Swap any Solana token on Nexus DEX with best-price routing across Jupiter, Raydium, and Orca. No KYC, no account, mobile-first, low slippage.",
    "buy-token": "Buy Solana tokens, memecoins, and new launches from your wallet on Nexus DEX. Best-price routing across Jupiter, Raydium, Orca. No signup.",
    "no-kyc-trading": "No-KYC trading on Nexus DEX covers perps, spot, tokenized stocks, and more. Connect a wallet, sign a transaction, trade without sharing data.",
    "whale-tracking": "Track Solana whales, smart money, memecoin insiders, deployer clusters, and KOL wallets on Nexus DEX. See accumulation before the chart moves.",
    "token-launch": "Launch a Solana token from your wallet on Nexus DEX. No KYC, no code, no upfront fees. Deploy memecoins via bonding curve to Raydium.",
    "wallet-trading": "Self-custodial trading on Nexus DEX from Phantom, Backpack, or Solflare. Your wallet is your account. Every trade settles on-chain.",
    "how-to-guides": "Step-by-step Nexus DEX guides for perps, stocks, swaps, token launches, and whale tracking from a Solana wallet without KYC.",
}

GENERIC_META = "Explore Nexus DEX features, workflows, and related pages for self-custodial trading from your Solana wallet. No KYC, no signup, mobile-first."


def compact_spaces(text):
    return re.sub(r"\s+", " ", str(text)).strip()


def normalize_keyword(text):
    return compact_spaces(str(text).lower())


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", normalize_keyword(text)).strip("-")


def load_keywords():
    if not os.path.exists(KEYWORDS_FILE):
        return []
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        return list(dict.fromkeys(normalize_keyword(line) for line in f if line.strip()))


def page_path(slug):
    return os.path.join(OUTPUT_DIR, slug, "index.html")


def page_exists(slug):
    return os.path.exists(page_path(slug))


def build_canonical(slug):
    return f"{SITE}/nexus-dex/defi/{slug}/"


def trim_meta_description(text, minimum=110, maximum=165):
    text = compact_spaces(text)
    if len(text) <= maximum:
        return text
    truncated = text[:maximum]
    return truncated.rstrip(" ,;.") + "."


def title_case(text):
    words = []
    for word in text.split():
        lower = word.lower()
        if lower in BRAND_CASE:
            words.append(BRAND_CASE[lower])
        else:
            words.append(word.capitalize())
    return " ".join(words)


def escape_html(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# -------------------------
# MATCHING + SCORING
# -------------------------

def matches_cluster(keyword, terms):
    kw = normalize_keyword(keyword)
    return any(term in kw for term in terms)


def score_keyword(keyword):
    return (len(keyword), keyword)


# -------------------------
# LINK BUILDER
# -------------------------

def build_related_link_items(cluster_keywords, valid_child_slugs):
    items = []
    seen = set()

    for keyword in cluster_keywords:
        slug = slugify(keyword)

        if (
            not slug
            or slug in seen
            or slug in PROTECTED_HUB_SLUGS
            or slug not in valid_child_slugs
            or not page_exists(slug)
        ):
            continue

        seen.add(slug)
        label = title_case(keyword)

        items.append({
            "slug": slug,
            "href": f"/nexus-dex/defi/{slug}/",
            "anchor": label,
        })

    return items


# -------------------------
# HTML
# -------------------------

def build_hub_html(slug, title, description, links):
    canonical = build_canonical(slug)
    links_html = "\n".join(
        f'<li><a href="{escape_html(l["href"])}">{escape_html(l["anchor"])}</a></li>'
        for l in links
    )

    return f"""<!DOCTYPE html>
<html>
<head>
<title>{escape_html(title)}</title>
<meta name="description" content="{escape_html(description)}">
<link rel="canonical" href="{canonical}">
</head>
<body>
<h1>{escape_html(title)}</h1>
<p>Explore features, workflows, and related pages for this category on Nexus DEX.</p>
<h2>Related Pages</h2>
<ul>
{links_html}
</ul>
</body>
</html>
"""


# -------------------------
# VALIDATION (LIGHT)
# -------------------------

def validate_hub(slug, description, html):
    errors = []
    if len(description) < 100:
        errors.append("weak description")
    if "<h1>" not in html:
        errors.append("missing h1")
    if "<ul>" not in html:
        errors.append("no links section")
    return errors


# -------------------------
# MAIN
# -------------------------

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    keywords = load_keywords()

    valid_child_slugs = {slugify(k) for k in keywords}
    valid_child_slugs -= PROTECTED_HUB_SLUGS

    built = 0
    warnings = []

    for hub_slug, terms in CLUSTERS.items():
        matched = [k for k in keywords if matches_cluster(k, terms)]
        matched = sorted(matched, key=score_keyword)[:MAX_LINKS_PER_HUB]

        link_items = build_related_link_items(matched, valid_child_slugs)

        title = HUB_TITLES.get(
            hub_slug,
            f"{title_case(hub_slug.replace('-', ' '))}: Features, Workflows & Related Pages"
        )

        description = trim_meta_description(
            HUB_META_DESCRIPTIONS.get(hub_slug, GENERIC_META)
        )

        html = build_hub_html(hub_slug, title, description, link_items)

        errors = validate_hub(hub_slug, description, html)
        if errors:
            warnings.append({"hub": hub_slug, "errors": errors})

        folder = os.path.join(OUTPUT_DIR, hub_slug)
        os.makedirs(folder, exist_ok=True)

        with open(os.path.join(folder, "index.html"), "w", encoding="utf-8") as f:
            f.write(html)

        built += 1
        print(f"Built {hub_slug} | links: {len(link_items)}")

    report = {
        "keywords": len(keywords),
        "built": built,
        "warnings": warnings,
    }

    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)

    print("\nDONE")
    print(report)


if __name__ == "__main__":
    main()
