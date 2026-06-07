import os
import re
from collections import Counter

SEED_FILE    = "data/nexus_dex_seed_keywords.txt"
PATTERN_FILE = "data/nexus_dex_patterns.txt"
OUTPUT_FILE  = "data/nexus_dex_keywords.txt"

MAX_KEYWORDS = 5000
MIN_WORDS    = 2
MAX_WORDS    = 12

# =============================================================================
# v18.4 filters
# All perps/Hyperliquid/leverage/stock-broker terms removed. The script
# enforces the Solana-DeFi-native voice through HIGH_INTENT_MARKERS and
# STRONG_SIGNAL_TERMS.
# =============================================================================

BANNED_SUBSTRINGS = [
    "swap swap",
    "buy buy",
    "sell sell",
    "trade trade",
    "wallet wallet",
    "is is ",
    "no no ",
    "no kyc no kyc",
    "kyc kyc",
    "verixia verixia",
    "nexus dex nexus dex",
    "wonderland wonderland",
    "bridge bridge",
    "memecoin memecoin",
    "meme meme",
    "brand brand",
    "stock stock",
    "tokenized tokenized",
    "whale whale",
    "launch launch",
    "signal signal",
    "trending trending",
    "self custodial self custodial",
    "non custodial non custodial",
    "wallet based wallet based",
    "wallet trading wallet trading",
    "swap on swap",
    "buy on buy",
    "from wallet from wallet",
    "on verixia on verixia",
]

LOW_VALUE_EXACT = {
    "swap",
    "buy",
    "sell",
    "trade",
    "trading",
    "wallet",
    "mobile",
    "app",
    "dex",
    "cex",
    "kyc",
    "bridge",
    "bridges",
    "meme",
    "memecoin",
    "memes",
    "stock",
    "stocks",
    "brand",
    "tokenized",
    "whale",
    "launch",
    "signal",
    "signals",
    "trending",
    "no kyc",
    "verixia",
    "nexus dex",
    "wonderland",
    "wallet trading",
    "self custodial",
    "non custodial",
}

# Markers that signal a high-value Solana DeFi query. A keyword must contain
# at least one of these OR start with a question word to survive filtering.
HIGH_INTENT_MARKERS = [
    # commercial
    "no kyc",
    "without kyc",
    "no signup",
    "no account",
    "no verification",
    "anonymous",
    "permissionless",
    "self custodial",
    "non custodial",
    "wallet based",
    "wallet native",
    "wallet only",
    "mobile",
    "phantom",
    "backpack",
    "solflare",
    # core actions
    "swap",
    "buy",
    "trade",
    "ape",
    "send",
    # solana DEX aggregation
    "dex aggregator",
    "best price",
    "jupiter",
    "raydium",
    "orca",
    "meteora",
    # v18.4 product surfaces
    "wonderland",
    "memecoin",
    "meme",
    "brand token",
    "brand tokens",
    "tokenized",
    "bridge",
    "to solana",
    "from solana",
    "cross chain",
    "wormhole",
    "debridge",
    "allbridge",
    # signals / discovery
    "trending",
    "signals",
    "fresh launch",
    "fresh launches",
    "top gainers",
    "volume leaders",
    "hot solana",
    "pumping",
    "mooning",
    "discovery",
    # whale tracking
    "whale",
    "smart money",
    "insider",
    "deployer",
    "sniper",
    "kol wallet",
    "early buyers",
    "first buyers",
    # token launch
    "launch",
    "launchpad",
    "bonding curve",
    "graduate",
    "deploy",
    # brand tickers (Solana SPL tokens that track popular brands)
    "aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax", "mstrx",
    "nflxx", "spyx", "qqqx", "crclx", "hoodx", "coinx", "orclx", "crmx",
    # branded products
    "verixia",
    "nexus dex",
]

QUESTION_STARTERS = (
    "is ",
    "is this ",
    "should ",
    "what ",
    "why ",
    "when ",
    "where ",
    "how ",
    "check ",
    "can ",
)

BAD_PREFIXES = (
    "is is ",
    "is this is ",
    "should i buy should i buy ",
    "how to how to ",
    "can i can i ",
    "buy buy ",
    "swap swap ",
    "bridge bridge ",
)

# Tokens that signal the keyword is on-topic for Verixia (Solana DeFi). At
# least one must appear in the phrase to pass filtering.
STRONG_SIGNAL_TERMS = {
    # commercial signals
    "no kyc",
    "without kyc",
    "no signup",
    "no account",
    "self custodial",
    "non custodial",
    "wallet based",
    "wallet only",
    "phantom",
    "backpack",
    "solflare",
    # action signals
    "swap",
    "buy",
    "trade",
    "ape",
    # discovery / intel signals
    "whale",
    "smart money",
    "insider",
    "deployer",
    "sniper",
    "trending",
    "signals",
    "discovery",
    "pumping",
    "mooning",
    "hot",
    # launch signals
    "launch",
    "launchpad",
    "bonding",
    "graduate",
    # chain / network signals
    "solana",
    "sol",
    "usdc",
    "spl",
    # bridge signals
    "bridge",
    "wormhole",
    "debridge",
    "allbridge",
    "cross chain",
    # meme signals (popular Solana memes)
    "hoppy", "fartcoin", "pepe", "wif", "bonk", "popcat", "mew", "wen",
    "bome", "myro", "ponke", "michi", "trump", "moodeng", "goat", "pnut",
    "pengu", "neiro", "fwog", "useless", "doge", "shib", "floki",
    # solana ecosystem tokens
    "jup", "ray", "pyth", "jto", "raydium", "jupiter", "orca", "meteora",
    # brand tokens (Solana SPL tokens that track popular brands)
    "aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax", "mstrx",
    "nflxx", "spyx", "qqqx", "crclx", "hoodx", "coinx", "orclx", "crmx",
    "tokenized",
    "brand",
    "memecoin",
    "wonderland",
}

# Solana-relevant chain context (used in bridge templates + scoring)
CHAIN_TERMS = {
    "solana",
    "sol",
    "ethereum",
    "eth",
    "base",
    "arbitrum",
    "arb",
    "optimism",
    "op",
    "polygon",
    "avalanche",
    "avax",
    "bnb",
    "bsc",
    "binance",
    "sui",
    "aptos",
    "near",
    "ton",
}

METRIC_TERMS = {
    "no kyc",
    "without kyc",
    "no signup",
    "no account",
    "no verification",
    "self custodial",
    "non custodial",
    "wallet based",
    "wallet only",
    "mobile",
    "best price",
    "dex aggregator",
    "on chain",
    "from wallet",
    "24 7",
    "weekend",
    "after hours",
    "global",
    "global access",
    "settled in usdc",
    "permissionless",
    "anonymous",
}

BUY_TERMS = {
    "swap",
    "buy",
    "sell",
    "trade",
    "ape",
    "send",
    "bridge",
    "lp",
    "borrow",
    "collateral",
}

SAFETY_TERMS = {
    "no kyc",
    "without kyc",
    "no signup",
    "no account",
    "no verification",
    "self custodial",
    "non custodial",
    "wallet based",
    "anonymous",
    "permissionless",
}

STOPWORDS = {
    "is",
    "this",
    "a",
    "an",
    "the",
    "to",
    "for",
    "of",
    "and",
    "or",
    "with",
    "on",
    "in",
    "can",
    "should",
    "what",
    "why",
    "when",
    "where",
    "how",
    "i",
    "now",
}


def clean_phrase(text: str) -> str:
    return " ".join(str(text).strip().lower().split())


def load_lines(path: str):
    """Load lines from a file. Skips empty lines and any line starting with '#'
    (so comments in the patterns file don't get treated as patterns)."""
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        out = []
        for raw in f:
            stripped = raw.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                continue
            cleaned = clean_phrase(stripped)
            if cleaned:
                out.append(cleaned)
        return out


def word_count(text: str) -> int:
    return len(text.split())


def has_duplicate_adjacent_words(text: str) -> bool:
    words = text.split()
    return any(words[i] == words[i + 1] for i in range(len(words) - 1))


def contains_term_phrase(text: str, needle: str) -> bool:
    return re.search(rf"(^|[^a-z0-9]){re.escape(needle)}([^a-z0-9]|$)", text) is not None


def contains_high_intent_marker(text: str) -> bool:
    return any(contains_term_phrase(text, marker) for marker in HIGH_INTENT_MARKERS)


def has_bad_double_patterns(text: str) -> bool:
    words = text.split()
    if len(words) < 4:
        return False
    bigrams = [" ".join(words[i:i + 2]) for i in range(len(words) - 1)]
    bigram_counts = Counter(bigrams)
    for bigram, count in bigram_counts.items():
        if count > 1 and bigram not in {"of the", "in the", "to the", "on the", "from the"}:
            return True
    return False


def has_excessive_repeated_terms(text: str) -> bool:
    words = text.split()
    meaningful = [w for w in words if w not in STOPWORDS]
    if not meaningful:
        return True
    counts = Counter(meaningful)
    max_count = max(counts.values())
    if max_count >= 3:
        return True
    repeated_unique = sum(1 for count in counts.values() if count > 1)
    if repeated_unique >= 2:
        return True
    return False


def has_signal_term(text: str) -> bool:
    return any(contains_term_phrase(text, term) for term in STRONG_SIGNAL_TERMS)


def phrase_signature(text: str) -> str:
    words = text.split()
    normalized = []
    for word in words:
        if word in STOPWORDS:
            continue
        normalized.append(word)
    return " ".join(normalized)


def is_valid_seed(seed: str) -> bool:
    if not seed:
        return False
    if len(seed) < 2:
        return False
    if "{" in seed or "}" in seed:
        return False
    if seed in LOW_VALUE_EXACT:
        return False
    if word_count(seed) > 8:
        return False
    if has_duplicate_adjacent_words(seed):
        return False
    if has_excessive_repeated_terms(seed):
        return False
    return True


def is_valid_phrase(phrase: str) -> bool:
    if not phrase:
        return False
    phrase = clean_phrase(phrase)
    if len(phrase) < 5:
        return False
    if "{" in phrase or "}" in phrase:
        return False
    if not re.search(r"[a-z]", phrase):
        return False
    if has_duplicate_adjacent_words(phrase):
        return False
    if word_count(phrase) < MIN_WORDS or word_count(phrase) > MAX_WORDS:
        return False
    if phrase in LOW_VALUE_EXACT:
        return False
    if any(bad in phrase for bad in BANNED_SUBSTRINGS):
        return False
    if any(phrase.startswith(bad) for bad in BAD_PREFIXES):
        return False
    if has_bad_double_patterns(phrase):
        return False
    if has_excessive_repeated_terms(phrase):
        return False
    if not contains_high_intent_marker(phrase) and not phrase.startswith(QUESTION_STARTERS):
        return False
    if not has_signal_term(phrase):
        return False
    if phrase.endswith((" is", " a", " an", " the", " or", " and", " to", " for", " from", " with", " on", " in")):
        return False
    return True


def quality_score(phrase: str):
    """Lower is better. Scores keywords by how well they match v18.4 product
    surfaces: brand tokens, Wonderland memes, bridges, signals, whale tracking,
    no-KYC swaps."""
    phrase = clean_phrase(phrase)
    count = word_count(phrase)

    starts_is_this = phrase.startswith("is this ")
    starts_is      = phrase.startswith("is ")
    starts_should  = phrase.startswith("should ")
    starts_what    = phrase.startswith("what ")
    starts_why     = phrase.startswith("why ")
    starts_how     = phrase.startswith("how ")
    starts_check   = phrase.startswith("check ")
    starts_can     = phrase.startswith("can ")

    has_action  = any(contains_term_phrase(phrase, term) for term in BUY_TERMS)
    has_custody = any(contains_term_phrase(phrase, term) for term in SAFETY_TERMS)
    has_no_kyc  = contains_term_phrase(phrase, "no kyc") or contains_term_phrase(phrase, "without kyc")

    # Product-surface buckets (one of these is the ideal hit)
    has_memes = (
        contains_term_phrase(phrase, "wonderland")
        or contains_term_phrase(phrase, "memecoin")
        or contains_term_phrase(phrase, "meme")
        or any(contains_term_phrase(phrase, t) for t in
               ["hoppy", "fartcoin", "pepe", "wif", "bonk", "popcat", "mew",
                "bome", "myro", "michi", "trump", "moodeng", "goat", "pnut",
                "pengu", "neiro", "fwog", "useless"])
    )
    has_brand = (
        contains_term_phrase(phrase, "brand token")
        or contains_term_phrase(phrase, "brand tokens")
        or contains_term_phrase(phrase, "tokenized")
        or any(contains_term_phrase(phrase, t) for t in
               ["aaplx", "tslax", "nvdax", "msftx", "googlx", "amznx", "metax",
                "mstrx", "nflxx", "spyx", "qqqx", "crclx", "hoodx", "coinx",
                "orclx", "crmx"])
    )
    has_bridge = (
        contains_term_phrase(phrase, "bridge")
        or contains_term_phrase(phrase, "to solana")
        or contains_term_phrase(phrase, "cross chain")
        or contains_term_phrase(phrase, "wormhole")
        or contains_term_phrase(phrase, "debridge")
        or contains_term_phrase(phrase, "allbridge")
    )
    has_signals = (
        contains_term_phrase(phrase, "trending")
        or contains_term_phrase(phrase, "signals")
        or contains_term_phrase(phrase, "fresh launches")
        or contains_term_phrase(phrase, "top gainers")
        or contains_term_phrase(phrase, "pumping")
        or contains_term_phrase(phrase, "mooning")
        or contains_term_phrase(phrase, "discovery")
    )
    has_whale = (
        contains_term_phrase(phrase, "whale")
        or contains_term_phrase(phrase, "smart money")
        or contains_term_phrase(phrase, "insider")
        or contains_term_phrase(phrase, "deployer")
        or contains_term_phrase(phrase, "sniper")
    )
    has_launch = (
        contains_term_phrase(phrase, "launch")
        or contains_term_phrase(phrase, "launchpad")
        or contains_term_phrase(phrase, "bonding")
        or contains_term_phrase(phrase, "graduate")
    )

    has_feature = any(contains_term_phrase(phrase, term) for term in METRIC_TERMS)
    has_chain   = any(contains_term_phrase(phrase, term) for term in CHAIN_TERMS)
    has_venue   = any(contains_term_phrase(phrase, term) for term in
                      {"swap", "dex", "raydium", "jupiter", "orca", "meteora",
                       "verixia", "nexus dex"})

    signature_len = len(phrase_signature(phrase).split())

    # Lower tuple value = better. Each "0 if X" condition pulls the score down.
    # The product-surface dimensions come early so we get coverage across
    # memes, brands, bridges, signals, whale tracking, and launches in the
    # top results -- rather than 5000 question-form swaps that crowd out
    # the discovery and intel keywords.
    return (
        0 if has_action else 1,
        0 if has_custody else 1,
        0 if has_no_kyc else 1,
        # Product-surface coverage: any of memes / brands / bridges / signals
        # / whale / launch counts as a strong hit
        0 if (has_memes or has_brand or has_bridge or has_signals
              or has_whale or has_launch) else 1,
        # Explicit boost for discovery + intel buckets so they make the
        # 5000-keyword cap (otherwise they get crowded out by swaps + bridges)
        0 if has_whale else 1,
        0 if has_signals else 1,
        0 if has_memes else 1,
        0 if has_brand else 1,
        0 if has_bridge else 1,
        0 if has_launch else 1,
        0 if has_feature else 1,
        0 if has_chain else 1,
        0 if has_venue else 1,
        0 if starts_should else 1,
        0 if starts_is_this else 1,
        0 if starts_is else 1,
        0 if starts_what else 1,
        0 if starts_why else 1,
        0 if starts_how else 1,
        0 if starts_check else 1,
        0 if starts_can else 1,
        abs(count - 5),
        abs(signature_len - 4),
        len(phrase),
        phrase,
    )


def choose_best_phrase(phrases):
    return sorted(phrases, key=quality_score)[0]


def dedupe_preserve_best(phrases):
    exact_best = {}
    signature_groups = {}
    for phrase in phrases:
        phrase = clean_phrase(phrase)
        if not is_valid_phrase(phrase):
            continue
        current = exact_best.get(phrase)
        if current is None or quality_score(phrase) < quality_score(current):
            exact_best[phrase] = phrase
    for phrase in exact_best.values():
        signature = phrase_signature(phrase)
        if not signature:
            continue
        signature_groups.setdefault(signature, []).append(phrase)
    best_phrases = []
    for group in signature_groups.values():
        best_phrases.append(choose_best_phrase(group))
    return best_phrases


def main():
    os.makedirs("data", exist_ok=True)
    seeds    = [seed for seed in load_lines(SEED_FILE) if is_valid_seed(seed)]
    patterns = load_lines(PATTERN_FILE)

    if not seeds:
        print(f"No usable seed keywords found in {SEED_FILE}")
        return
    if not patterns:
        print(f"No patterns found in {PATTERN_FILE}")
        return

    keywords = []
    for seed in seeds:
        for pattern in patterns:
            if "{keyword}" in pattern:
                phrase = clean_phrase(pattern.replace("{keyword}", seed))
            else:
                # Standalone pattern (no substitution). Emitted once after
                # dedup, regardless of how many seeds the loop touches.
                phrase = clean_phrase(pattern)
            if is_valid_phrase(phrase):
                keywords.append(phrase)

    keywords = dedupe_preserve_best(keywords)
    keywords = sorted(keywords, key=quality_score)
    keywords = keywords[:MAX_KEYWORDS]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for kw in keywords:
            f.write(kw + "\n")

    print(f"Seeds loaded:    {len(seeds)}")
    print(f"Patterns loaded: {len(patterns)}")
    print(f"Generated {len(keywords)} Verixia keywords (capped at {MAX_KEYWORDS})")


if __name__ == "__main__":
    main()