import os
import re
import json
from collections import Counter

SEED_FILE     = "data/nexus_dex_seed_keywords.txt"
PATTERN_FILE  = "data/nexus_dex_patterns.txt"
TOKENS_FILE   = "data/jupiter_tokens.json"     # written by scripts/fetch_jupiter_tokens.mjs
THEMES_FILE   = "data/nexus_dex_launch_themes.txt"  # optional; for launch patterns
OUTPUT_FILE   = "data/nexus_dex_keywords.txt"

MAX_KEYWORDS  = 60000          # raised: real-token gate makes volume safe
MIN_WORDS     = 2
MAX_WORDS     = 12

# ---- THE GATE DIALS --------------------------------------------------------
# A page is only generated for a token in jupiter_tokens.json. These floors let
# you tighten further per-block without re-fetching.
CORE_LIQ_FLOOR   = 0           # 0 = trust the fetcher's floor (everything tradable)
PAIRS_LIQ_FLOOR  = 25_000      # pairs explode combinatorially -> only liquid bases/quotes
PAIRS_PER_BASE   = 12          # hard cap: max partner tokens per base token
PAIRS_MAX_BASES  = 150         # only the top-N most-liquid tokens get pair pages

# =============================================================================
# v19 — REAL-TOKEN GATE
# Perps / Hyperliquid / leverage / hedge patterns are gone from the pattern
# file. This script no longer trusts lexical markers alone; a keyword that
# substitutes {keyword} must resolve to a REAL, tradable Solana token (or, for
# stock patterns, a real tokenized-stock symbol present in the token list).
# Launch patterns expand from a small THEMES list, never the token universe.
# =============================================================================

# Brand/stock symbols are only valid if their tokenized ticker (e.g. AAPLx) is
# actually present in jupiter_tokens.json. We map a human brand seed -> ticker
# and then require that ticker to exist in the live list. No list entry -> no
# page (this auto-gates the securities compliance problem).
BRAND_TICKER_MAP = {
    "apple": "AAPLx", "aapl": "AAPLx",
    "tesla": "TSLAx", "tsla": "TSLAx",
    "nvidia": "NVDAx", "nvda": "NVDAx",
    "microsoft": "MSFTx", "msft": "MSFTx",
    "google": "GOOGLx", "alphabet": "GOOGLx", "googl": "GOOGLx",
    "amazon": "AMZNx", "amzn": "AMZNx",
    "meta": "METAx",
    "netflix": "NFLXx", "nflx": "NFLXx",
    "microstrategy": "MSTRx", "mstr": "MSTRx",
    "coinbase": "COINx", "coin": "COINx",
    "robinhood": "HOODx", "hood": "HOODx",
    "circle": "CRCLx", "crcl": "CRCLx",
    "oracle": "ORCLx", "orcl": "ORCLx",
    "salesforce": "CRMx", "crm": "CRMx",
    "spy": "SPYx", "sp500": "SPYx", "qqq": "QQQx",
}

# -----------------------------------------------------------------------------
# Token universe (loaded at runtime)
# -----------------------------------------------------------------------------
TOKENS = {}              # symbol_lower -> {mint, liquidity, volume24h, mcap, verified}
TOKEN_SYMS = set()       # set of lowercase symbols present
STOCK_SYMS = set()       # lowercase tokenized-stock tickers present (e.g. "aaplx")


def load_token_universe():
    global TOKENS, TOKEN_SYMS, STOCK_SYMS
    if not os.path.exists(TOKENS_FILE):
        raise SystemExit(
            f"\nFATAL: {TOKENS_FILE} not found.\n"
            f"Run the token fetch first:  node scripts/fetch_jupiter_tokens.mjs\n"
            f"(No token list = no gate. Refusing to generate ungated pages.)\n"
        )
    with open(TOKENS_FILE, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, dict) or not raw:
        raise SystemExit(f"FATAL: {TOKENS_FILE} is empty or malformed. Re-run the fetcher.")
    TOKENS = {sym.lower(): meta for sym, meta in raw.items()}
    TOKEN_SYMS = set(TOKENS.keys())
    STOCK_SYMS = {s for s in TOKEN_SYMS if re.search(r"x$", s) and s[:-1].isalpha()}
    print(f"Token universe: {len(TOKEN_SYMS)} tokens "
          f"({sum(1 for m in TOKENS.values() if m.get('verified'))} verified, "
          f"{len(STOCK_SYMS)} xStock-like)")


def resolve_token(seed: str):
    """Return the token meta if `seed` is a real tradable token, else None.
    Matches on symbol (exact, case-insensitive)."""
    s = seed.strip().lower()
    meta = TOKENS.get(s)
    if not meta:
        return None
    if CORE_LIQ_FLOOR and not meta.get("verified") and meta.get("liquidity", 0) < CORE_LIQ_FLOOR:
        return None
    return meta


def resolve_stock(seed: str):
    """Return the tokenized-stock ticker if `seed` is a brand whose xStock
    exists in the live token list, else None. Gates securities by reality."""
    s = seed.strip().lower()
    ticker = BRAND_TICKER_MAP.get(s)
    if ticker and ticker.lower() in TOKEN_SYMS:
        return ticker
    # also allow direct ticker seeds like "aaplx"
    if s in STOCK_SYMS:
        return TOKENS[s] and s.upper()
    return None


# -----------------------------------------------------------------------------
# Pattern classification (by content, since the pattern file has no headers)
# -----------------------------------------------------------------------------
def pattern_kind(pattern: str) -> str:
    p = pattern.lower()
    if "{keyword2}" in p:
        return "pair"
    if "stock" in p:
        return "stock"
    if any(w in p for w in (" whale", "holders", "wallet concentration",
                            "who is buying", "who is selling", "holder breakdown",
                            "whale tracker", "whale alerts")):
        return "whale"
    if any(w in p for w in ("launchpad", "bonding curve", "launch a ", "fair launch",
                            "create {keyword} token", "launch ")):
        return "launch"
    return "core"


# =============================================================================
# Validation helpers (kept from prior version, toxic markers pruned)
# =============================================================================
STOPWORDS = {
    "is", "this", "a", "an", "the", "to", "for", "of", "and", "or", "with",
    "on", "in", "can", "should", "what", "why", "when", "where", "how", "i", "now",
}

BANNED_SUBSTRINGS = [
    "swap swap", "buy buy", "sell sell", "trade trade", "to to", "vs vs",
    "stock stock", "tokenized tokenized", "whale whale", "launch launch",
    "no kyc no kyc", "verixia verixia", "from wallet from wallet",
]


def clean_phrase(text: str) -> str:
    return " ".join(str(text).strip().lower().split())


def load_lines(path: str):
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            s = raw.strip()
            if not s or s.startswith("#"):
                continue
            c = clean_phrase(s) if "{keyword" not in s.lower() else s.strip().lower()
            if c:
                out.append(c)
    return out


def load_patterns(path: str):
    """Patterns keep their {keyword}/{keyword2} placeholders verbatim; only
    comments and blanks are skipped."""
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            s = raw.strip()
            if not s or s.startswith("#"):
                continue
            out.append(s.lower())
    return out


def word_count(text: str) -> int:
    return len(text.split())


def has_duplicate_adjacent_words(text: str) -> bool:
    w = text.split()
    return any(w[i] == w[i + 1] for i in range(len(w) - 1))


def is_valid_seed(seed: str) -> bool:
    if not seed or len(seed) < 2:
        return False
    if "{" in seed or "}" in seed:
        return False
    if word_count(seed) > 6:
        return False
    if has_duplicate_adjacent_words(seed):
        return False
    return True


def is_valid_phrase(phrase: str) -> bool:
    if not phrase:
        return False
    phrase = clean_phrase(phrase)
    if len(phrase) < 5:
        return False
    if "{" in phrase or "}" in phrase:   # all placeholders must be filled
        return False
    if not re.search(r"[a-z]", phrase):
        return False
    if has_duplicate_adjacent_words(phrase):
        return False
    if word_count(phrase) < MIN_WORDS or word_count(phrase) > MAX_WORDS:
        return False
    if any(b in phrase for b in BANNED_SUBSTRINGS):
        return False
    if phrase.endswith((" to", " vs", " with", " on", " in", " from", " a", " the")):
        return False
    return True


def phrase_signature(text: str) -> str:
    return " ".join(w for w in text.split() if w not in STOPWORDS)


# =============================================================================
# Expansion
# =============================================================================
def liquidity_of(sym_lower: str) -> float:
    m = TOKENS.get(sym_lower)
    return float(m.get("liquidity", 0)) if m else 0.0


def expand():
    seeds_raw = load_lines(SEED_FILE)
    seeds     = [s for s in seeds_raw if is_valid_seed(s)]
    patterns  = load_patterns(PATTERN_FILE)
    themes    = load_lines(THEMES_FILE)  # may be empty

    if not patterns:
        raise SystemExit(f"No patterns found in {PATTERN_FILE}")
    if not seeds:
        raise SystemExit(f"No usable seeds in {SEED_FILE}")

    # Split patterns by kind once.
    by_kind = {"core": [], "stock": [], "whale": [], "launch": [], "pair": []}
    for p in patterns:
        by_kind[pattern_kind(p)].append(p)

    out = []
    stats = Counter()

    # Pre-compute the token-backed seed sets.
    # core/whale: seed must resolve to a real token.
    real_token_seeds = [s for s in seeds if resolve_token(s)]
    # stock: seed must map to a real xStock present in the list.
    stock_seeds = [(s, resolve_stock(s)) for s in seeds]
    stock_seeds = [(s, t) for (s, t) in stock_seeds if t]

    # ---- CORE + WHALE : real-token gated ----
    for kind in ("core", "whale"):
        for pat in by_kind[kind]:
            for s in real_token_seeds:
                phrase = clean_phrase(pat.replace("{keyword}", s))
                if is_valid_phrase(phrase):
                    out.append(phrase); stats[kind] += 1

    # ---- STOCK : only brands whose xStock is live; "no kyc/broker" already
    #      stripped from the pattern file. Use the human brand word in the URL/
    #      copy (reads naturally), gated by the real ticker's existence. ----
    for pat in by_kind["stock"]:
        for (brand, ticker) in stock_seeds:
            phrase = clean_phrase(pat.replace("{keyword}", brand))
            if is_valid_phrase(phrase):
                out.append(phrase); stats["stock"] += 1

    # ---- LAUNCH : expand from THEMES, never the token universe ----
    #      (so we never produce "bonk launchpad" nonsense). If no themes file,
    #      only the placeholder-free launch patterns survive.
    for pat in by_kind["launch"]:
        if "{keyword}" in pat:
            for th in themes:
                phrase = clean_phrase(pat.replace("{keyword}", th))
                if is_valid_phrase(phrase):
                    out.append(phrase); stats["launch"] += 1
        else:
            phrase = clean_phrase(pat)
            if is_valid_phrase(phrase):
                out.append(phrase); stats["launch"] += 1

    # ---- PAIRS : real x real, capped. Only the most-liquid bases, each paired
    #      with its top-N most-liquid partners. This is the block that can
    #      re-create doorways if uncapped, so the cap is hard. ----
    if by_kind["pair"]:
        liquid = [s for s in real_token_seeds if liquidity_of(s) >= PAIRS_LIQ_FLOOR]
        liquid.sort(key=liquidity_of, reverse=True)
        bases = liquid[:PAIRS_MAX_BASES]
        partners = liquid[:PAIRS_PER_BASE + 1]  # top liquid set to pair against
        for pat in by_kind["pair"]:
            for a in bases:
                count = 0
                for b in partners:
                    if a == b:
                        continue
                    phrase = clean_phrase(pat.replace("{keyword2}", b).replace("{keyword}", a))
                    if is_valid_phrase(phrase):
                        out.append(phrase); stats["pair"] += 1; count += 1
                    if count >= PAIRS_PER_BASE:
                        break

    # ---- de-dupe (exact + signature) ----
    seen_exact = set()
    deduped = []
    for ph in out:
        if ph in seen_exact:
            continue
        seen_exact.add(ph)
        deduped.append(ph)

    seen_sig = set()
    final = []
    for ph in deduped:
        sig = phrase_signature(ph)
        if sig in seen_sig:
            continue
        seen_sig.add(sig)
        final.append(ph)

    final = final[:MAX_KEYWORDS]

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for kw in final:
            f.write(kw + "\n")

    print(f"Seeds:    {len(seeds)} ({len(real_token_seeds)} resolve to real tokens, "
          f"{len(stock_seeds)} to live xStocks)")
    print(f"Patterns: {len(patterns)}  -> core {len(by_kind['core'])}, "
          f"stock {len(by_kind['stock'])}, whale {len(by_kind['whale'])}, "
          f"launch {len(by_kind['launch'])}, pair {len(by_kind['pair'])}")
    print(f"Generated per block: {dict(stats)}")
    print(f"Wrote {len(final)} gated keywords -> {OUTPUT_FILE} (cap {MAX_KEYWORDS})")


def main():
    load_token_universe()
    expand()


if __name__ == "__main__":
    main()
