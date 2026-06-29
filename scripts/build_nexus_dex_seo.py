import os
import re
from html import escape
from pathlib import Path

from generate_nexus_dex_content import generate_nexus_dex_content

# -----------------------------
# CONFIG
# -----------------------------
KEYWORD_FILE = "data/nexus_dex_keywords.txt"
REJECTED_KEYWORDS_FILE = "data/nexus_dex_rejected_keywords.txt"
TEMPLATE_FILE = "nexus-dex-template/nexus-dex-template.html"
OUTPUT_DIR = "defi"
SITE = "https://verixiaapps.com"

RELATED_LINKS_COUNT = 6
MORE_LINKS_COUNT = 10

PROTECTED_SLUGS = {
    "nexus-dex",
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
}

REQUIRED_TEMPLATE_PLACEHOLDERS = {
    "{{TITLE}}",
    "{{DESCRIPTION}}",
    "{{KEYWORD}}",
    "{{AI_CONTENT}}",
    "{{RELATED_LINKS}}",
    "{{MORE_LINKS}}",
    "{{HUB_LINK}}",
    "{{CANONICAL_URL}}",
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
    # xStocks / tokenized stocks cluster
    "xstocks", "xstock", "tokenized", "stocks", "stock", "equity", "equities",
    "onchain", "fractional", "brokerage", "broker", "backed",
    "aapl", "tsla", "nvda", "msft", "googl", "amzn", "meta", "mstr", "nflx",
    "amd", "coin", "hood", "crcl", "spy", "qqq", "gld",
    "aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax", "mstrx",
    "nflxx", "spyx", "qqqx", "crclx",
}

BRAND_CASE = {
    "nexus dex": "Nexus DEX",
    "binance smart chain": "Binance Smart Chain",
    "trust wallet": "Trust Wallet",
    "raydium launchlab": "Raydium LaunchLab",
    "pump fun": "Pump Fun",
    "backed finance": "Backed Finance",
    "hyperliquid": "Hyperliquid",
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
    "phantom": "Phantom",
    "backpack": "Backpack",
    "solflare": "Solflare",
    "bitcoin": "Bitcoin",
    "solana": "Solana",
    "binance": "Binance",
    "jupiter": "Jupiter",
    "orca": "Orca",
    "drift": "Drift",
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
    "aapl": "AAPL",
    "tsla": "TSLA",
    "nvda": "NVDA",
    "msft": "MSFT",
    "googl": "GOOGL",
    "amzn": "AMZN",
    "mstr": "MSTR",
    "nflx": "NFLX",
    "amd": "AMD",
    "coin": "COIN",
    "hood": "HOOD",
    "crcl": "CRCL",
    "spy": "SPY",
    "qqq": "QQQ",
    "gld": "GLD",
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
    "jup": "JUP",
    "ray": "RAY",
    "pyth": "PYTH",
    "jto": "JTO",
    "hype": "HYPE",
    "spx": "SPX",
    "ai16z": "ai16z",
    "fartcoin": "FARTCOIN",
    "moodeng": "MOODENG",
    "pnut": "PNUT",
    "goat": "GOAT",
    "griffain": "GRIFFAIN",
    "chillguy": "CHILLGUY",
    "zerebro": "ZEREBRO",
    "dex": "DEX",
    "cex": "CEX",
    "kyc": "KYC",
    "spl": "SPL",
    "nft": "NFT",
    "dao": "DAO",
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
}

# Order matters: most specific first
HUB_MATCH_RULES = [
    ("hyperliquid", "hyperliquid-frontend"),

    # xStocks / tokenized stocks (specific BEFORE generic stock terms)
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

    # Perps
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

    # Whale
    ("whale tracker", "whale-tracking"),
    ("smart money", "whale-tracking"),
    ("insider", "whale-tracking"),
    ("deployer", "whale-tracking"),
    ("sniper", "whale-tracking"),
    ("kol wallet", "whale-tracking"),

    # Launch
    ("launch token", "token-launch"),
    ("token launch", "token-launch"),
    ("launchpad", "token-launch"),
    ("bonding curve", "token-launch"),
    ("deploy token", "token-launch"),

    # Swap
    ("solana swap", "solana-swap"),
    ("solana dex", "solana-swap"),
    ("dex aggregator", "solana-swap"),
    ("best price swap", "solana-swap"),
    ("swap", "solana-swap"),

    # Buy token
    ("buy bonk", "buy-token"),
    ("buy wif", "buy-token"),
    ("buy pepe", "buy-token"),
    ("buy trump", "buy-token"),
    ("buy memecoin", "buy-token"),
    ("buy spl", "buy-token"),
    ("buy ", "buy-token"),

    # Wallet
    ("phantom wallet trading", "wallet-trading"),
    ("backpack wallet trading", "wallet-trading"),
    ("self custodial", "wallet-trading"),
    ("non custodial", "wallet-trading"),
    ("wallet based", "wallet-trading"),

    # No KYC (generic, after specific stocks-no-kyc rules)
    ("no kyc", "no-kyc-trading"),
    ("without kyc", "no-kyc-trading"),
    ("no signup", "no-kyc-trading"),
    ("no verification", "no-kyc-trading"),

    # Perps (generic fallback, after specific assets)
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
    # xStocks high-intent
    "xstocks", "xstock", "tokenized", "stocks", "stock", "equity", "equities",
    "aapl", "tsla", "nvda", "msft", "googl", "amzn", "meta", "mstr", "spy", "qqq",
    "aaplx", "tslax", "nvdax", "spyx", "qqqx",
}

rejected_count = 0
deduped_keywords_count = 0
skipped_duplicate_keywords_count = 0
skipped_weak_keywords_count = 0
ai_failure_count = 0


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

    kw = re.sub(r"\s+", " ", kw).strip()
    return kw


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


def build_title(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)

    if not raw:
        return "Nexus DEX | Self-Custodial Perps, Swaps & Tokenized Stocks"

    if is_guidance_style_keyword(raw):
        return f"{title_case(raw)} | Nexus DEX Wallet Guide"

    if raw.startswith("is this "):
        return f"{title_case(raw)}? Self-Custodial Trading on Nexus DEX"

    if raw.startswith("should i buy "):
        cleaned = re.sub(r"^should i buy\s+", "", raw).strip()
        return f"Should I Buy {title_case(cleaned)}? Nexus DEX Best Price No KYC"

    if raw.startswith("can i "):
        return f"{title_case(raw)}? Nexus DEX Wallet-Based No KYC Trading"

    if is_question_style_keyword(raw):
        return f"{title_case(raw)}? Nexus DEX Self-Custodial Trading"

    return f"{readable} | Nexus DEX | Self-Custodial, No KYC, Mobile-First"


def build_description(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)
    clean_kw = display_keyword(keyword)

    if is_guidance_style_keyword(raw) or is_question_style_keyword(raw):
        return (
            f"Use Nexus DEX for {readable}. Self-custodial perps, swaps, and tokenized stocks "
            f"from your Solana wallet with no KYC, no signup, and mobile-first access."
        )

    return (
        f"{readable} on Nexus DEX. Self-custodial trading from your wallet with best-price routing, "
        f"no KYC, and mobile-first access. Trade {clean_kw} without a centralized exchange."
    )


def build_canonical(slug):
    return f"{SITE}/nexus-dex/defi/{slug}/"


def validate_template_placeholders(template_html):
    missing = [placeholder for placeholder in REQUIRED_TEMPLATE_PLACEHOLDERS if placeholder not in template_html]
    if missing:
        raise ValueError("Template is missing required placeholders: " + ", ".join(sorted(missing)))


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
    return "crypto-markets"


def build_hub_link_html(keyword):
    hub_slug = find_best_hub_slug(keyword)
    hub_title = HUB_TITLE_OVERRIDES.get(hub_slug, f"{title_case(hub_slug.replace('-', ' '))} Hub")
    return f'<a href="/nexus-dex/defi/{hub_slug}/">{escape_html(hub_title)}</a>'


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

    # Brand reinforcement
    if "nexus dex" in kw:
        score += 12

    # Strong feature signals
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

    # xStocks / tokenized stocks
    if "xstocks" in kw or "xstock" in kw or "tokenized stock" in kw or "tokenized equity" in kw:
        score += 10
    if "stocks on solana" in kw or "onchain stocks" in kw or "stocks as spl" in kw:
        score += 8
    if "24 7 stock" in kw or "stocks 24 hours" in kw or "stocks weekend" in kw:
        score += 7
    if any(tok in kw for tok in ["aapl", "tsla", "nvda", "msft", "googl", "amzn", "spy", "qqq", "mstr"]):
        score += 6

    # Asset signals
    if any(term in kw for term in ["btc", "bitcoin", "eth", "ethereum", "sol", "solana"]):
        score += 6
    if any(term in kw for term in ["wif", "bonk", "pepe", "doge", "hype", "popcat", "trump", "fartcoin"]):
        score += 7

    # Action signals
    if any(term in kw for term in ["swap", "buy", "trade", "short", "long", "hedge"]):
        score += 5
    if any(term in kw for term in ["phantom", "backpack", "solflare", "wallet"]):
        score += 6
    if "mobile" in kw or "app" in kw:
        score += 4

    # Whale / launch / smart money
    if "whale" in kw or "smart money" in kw or "insider" in kw or "deployer" in kw:
        score += 7
    if "launch" in kw or "launchpad" in kw or "bonding curve" in kw:
        score += 6

    # Penalties
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
    global deduped_keywords_count, skipped_duplicate_keywords_count, skipped_weak_keywords_count

    groups = {}
    for keyword in raw_keywords:
        key = canonical_keyword(keyword)
        groups.setdefault(key, []).append(keyword)

    canonical_keywords = []
    seen_slugs = set()

    for _, group in groups.items():
        chosen = choose_canonical_keyword(group)
        chosen_slug = canonical_slug(chosen)

        if chosen_slug in PROTECTED_SLUGS:
            continue

        if is_weak_keyword(chosen):
            skipped_weak_keywords_count += len(group)
            continue

        if chosen_slug in seen_slugs:
            skipped_duplicate_keywords_count += len(group)
            continue

        canonical_keywords.append(chosen)
        seen_slugs.add(chosen_slug)

        if len(group) > 1:
            deduped_keywords_count += len(group) - 1

    return canonical_keywords


def get_related_pages(current_page, all_pages, limit):
    current_slug = current_page["slug"]
    current_keyword = current_page["keyword"]
    current_tokens = keyword_tokens(current_keyword)
    current_cluster = keyword_cluster_tokens(current_keyword)
    current_root = keyword_root(current_keyword)
    current_hub = find_best_hub_slug(current_keyword)

    candidates = [
        p for p in all_pages
        if p["slug"] != current_slug and p["slug"] not in PROTECTED_SLUGS
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

        return (
            -same_hub,
            -same_root,
            -shared_cluster,
            -shared_tokens,
            length_diff,
            other_keyword,
        )

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

    if len(related) < limit:
        for page in candidates:
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
            and find_best_hub_slug(p["keyword"]) == current_hub
        ]

    fallback_pages = [
        p for p in all_pages
        if p["slug"] != current_slug
        and p["slug"] not in exclude_slugs
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


def validate_page_output(slug, title, description, canonical, related_pages):
    errors = []

    if not slug:
        errors.append("empty slug")
    if not canonical.endswith(f"/{slug}/"):
        errors.append("canonical mismatch")
    if len(related_pages) == 0:
        errors.append("no related pages")
    if len(title) < 35 or len(title) > 78:
        errors.append("title length out of target range")
    if len(description) < 110 or len(description) > 170:
        errors.append("description length out of target range")

    return errors


def ensure_file(filepath):
    folder = os.path.dirname(filepath)
    if folder:
        os.makedirs(folder, exist_ok=True)
    if not os.path.exists(filepath):
        with open(filepath, "a", encoding="utf-8"):
            pass


def append_rejected_keyword(keyword, reason):
    global rejected_count

    ensure_file(REJECTED_KEYWORDS_FILE)
    entry = f"{normalize_keyword(keyword)} | {str(reason).strip()}"

    existing = set()
    with open(REJECTED_KEYWORDS_FILE, "r", encoding="utf-8") as f:
        existing = {line.strip() for line in f if line.strip()}

    if entry not in existing:
        with open(REJECTED_KEYWORDS_FILE, "a", encoding="utf-8") as f:
            f.write(entry + "\n")
        rejected_count += 1


def build_related_anchor(keyword):
    raw = normalize_keyword(keyword)
    readable = readable_keyword(keyword)

    if is_guidance_style_keyword(raw) or is_question_style_keyword(raw):
        anchor = title_case(raw)
        if is_question_style_keyword(raw) and not anchor.endswith("?"):
            anchor += "?"
        return anchor

    return f"{readable} on Nexus DEX"


def is_usable_ai_text(text):
    if not text:
        return False

    raw = str(text).strip()
    lowered = raw.lower()

    if len(raw) < 350:
        return False

    weak_markers = {
        "lorem ipsum",
        "as an ai",
        "here are some paragraphs",
        "let me know if you want",
        "i can't help with that",
        "i cannot help with that",
        "i am sorry",
        "cannot assist",
        "can't assist",
        "policy",
        "content policy",
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


def generate_ai_text(keyword, keyword_display):
    attempts = []
    raw_keyword = normalize_keyword(keyword)
    clean_keyword = normalize_keyword(keyword_display)

    if raw_keyword:
        attempts.append(raw_keyword)

    if clean_keyword and clean_keyword != raw_keyword:
        attempts.append(clean_keyword)

    readable = readable_keyword(keyword_display)
    if readable:
        attempts.append(readable)

    if clean_keyword:
        attempts.append(f"{clean_keyword} nexus dex")

    if clean_keyword and not contains_term_phrase(raw_keyword, "kyc"):
        attempts.append(f"{clean_keyword} no kyc")

    if clean_keyword and not contains_term_phrase(raw_keyword, "wallet"):
        attempts.append(f"{clean_keyword} from wallet")

    seen = set()
    ordered_attempts = []

    for item in attempts:
        item_norm = normalize_keyword(item)
        if item_norm and item_norm not in seen:
            seen.add(item_norm)
            ordered_attempts.append(item)

    last_error = None

    for attempt in ordered_attempts:
        try:
            ai_text = generate_nexus_dex_content(attempt)
            if is_usable_ai_text(ai_text):
                return ai_text
            last_error = f"thin or malformed output for prompt: {attempt}"
        except Exception as e:
            last_error = str(e)

    raise ValueError(last_error or "AI generation failed")


# -----------------------------
# SETUP
# -----------------------------
os.makedirs(OUTPUT_DIR, exist_ok=True)
ensure_file(REJECTED_KEYWORDS_FILE)

template = load_template()
raw_keywords = load_keywords()
keywords = dedupe_keywords(raw_keywords)

pages = []
seen_page_slugs = set()

for keyword in keywords:
    slug = canonical_slug(keyword)
    if not slug or slug in PROTECTED_SLUGS or slug in seen_page_slugs:
        continue
    pages.append({"keyword": keyword, "slug": slug})
    seen_page_slugs.add(slug)


# -----------------------------
# GENERATE PAGES (ALWAYS REBUILD)
# -----------------------------
generated_count = 0
error_count = 0
validation_error_count = 0

for page in pages:
    slug = page["slug"]
    keyword = page["keyword"]
    keyword_display = display_keyword(keyword)

    if slug in PROTECTED_SLUGS:
        print("Skipping protected page:", slug)
        continue

    folder = Path(OUTPUT_DIR) / slug
    path = folder / "index.html"
    folder.mkdir(parents=True, exist_ok=True)

    title = build_title(keyword)
    description = build_description(keyword)
    canonical = build_canonical(slug)

    try:
        ai_text = generate_ai_text(keyword, keyword_display)
    except Exception as e:
        ai_failure_count += 1
        append_rejected_keyword(keyword, e)
        print("AI generation rejected for", keyword, ":", e)
        continue

    related_pages = get_related_pages(page, pages, RELATED_LINKS_COUNT)
    related_slugs = {p["slug"] for p in related_pages}

    more_links_pages = get_more_links(
        page,
        pages,
        MORE_LINKS_COUNT,
        exclude_slugs=related_slugs,
    )

    hub_link_html = build_hub_link_html(keyword)

    validation_errors = validate_page_output(slug, title, description, canonical, related_pages)
    if validation_errors:
        validation_error_count += 1
        print("Validation warning for", slug, ":", "; ".join(validation_errors))

    links_html = "".join(
        f'<li><a href="/nexus-dex/defi/{r["slug"]}/">{escape_html(build_related_anchor(r["keyword"]))}</a></li>\n'
        for r in related_pages
    )

    more_links_html = "".join(
        f'<li><a href="/nexus-dex/defi/{r["slug"]}/">{escape_html(build_related_anchor(r["keyword"]))}</a></li>\n'
        for r in more_links_pages
    )

    html = template
    html = html.replace("{{TITLE}}", escape_html(title))
    html = html.replace("{{DESCRIPTION}}", escape_html(description))
    html = html.replace("{{KEYWORD}}", escape_html(keyword_display))
    html = html.replace("{{AI_CONTENT}}", ai_text)
    html = html.replace("{{RELATED_LINKS}}", links_html)
    html = html.replace("{{MORE_LINKS}}", more_links_html)
    html = html.replace("{{HUB_LINK}}", hub_link_html)
    html = html.replace("{{CANONICAL_URL}}", escape_html(canonical))

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        generated_count += 1
        print("Generated:", slug)
    except Exception as e:
        error_count += 1
        print("Error writing page for", slug, ":", e)

print("\n--- NEXUS DEX SEO BUILD REPORT ---")
print("Raw keywords loaded:", len(raw_keywords))
print("Canonical keywords used:", len(keywords))
print("Duplicate / fragmented keywords removed:", deduped_keywords_count)
print("Duplicate slug groups skipped:", skipped_duplicate_keywords_count)
print("Weak / low-value keywords skipped:", skipped_weak_keywords_count)
print("Pages generated:", generated_count)
print("AI generations rejected:", ai_failure_count)
print("Rejected keywords logged:", rejected_count)
print("Validation warnings:", validation_error_count)
print("Write errors:", error_count)
 