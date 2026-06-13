"""
build_nexus_dex_hubs.py -- v2.1 (Verixia / swap.v migration)

What changed from v2.0 -> v2.1:
  - OUTPUT_DIR moved from "defi" to "public" so hub pages ship at
    https://swap.verixiaapps.com/<hub-slug>/ (same origin as the approved
    swap dApp). This fixes the Phantom "new website" warning when users
    sign trades from a hub page.
  - Canonical URLs / og:url / JSON-LD CollectionPage url all point to the
    new SWAP_SITE constant.
  - Internal hrefs in related-link items emit "/<slug>/" instead of
    "/nexus-dex/defi/<slug>/".
  - BreadcrumbList position 2 changed from "Verixia" @ SITE/nexus-dex/defi/
    to "Verixia Swap" @ SWAP_SITE/. Position 1 ("Home" @ SITE) preserved as
    the parent-brand reference.
  - Top-bar logo, top-bar "Open Verixia" pill, mid-page tool CTA, and the
    breadcrumb Verixia link now all point at SWAP_SITE/. The breadcrumb
    "Home" link still points at SITE (parent brand) — intentional.
  - ItemList schema URLs use SWAP_SITE + the new short href.
  - SITE (https://verixiaapps.com) stays in scope for the parent-brand
    "Home" link and any other intentional parent references.

Content / HTML / CSS / cluster definitions are unchanged from v2.0.
"""

import os
import re
import sys
import json
from collections import Counter

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(BASE_DIR)

from data.nexus_dex_clusters import CLUSTERS

KEYWORDS_FILE = os.path.join(BASE_DIR, "data", "nexus_dex_generated_keywords.txt")
OUTPUT_DIR    = os.path.join(BASE_DIR, "public")

# SITE is the parent brand origin. Only used for the top-level breadcrumb
# "Home" link / BreadcrumbList position 1. Everything else now lives on
# SWAP_SITE so the hub pages share an origin with the approved swap dApp.
SITE      = "https://verixiaapps.com"
SWAP_SITE = "https://swap.verixiaapps.com"

MAX_LINKS_PER_HUB     = 50
TOP_TOPICS_COUNT      = 8
MAX_RELATED_TOPICS    = 10
MAX_FAQS              = 4
MAX_COMMON_SCENARIOS  = 5
MAX_COMPARISON_POINTS = 4
REPORT_PATH           = os.path.join(OUTPUT_DIR, "_hub_build_report.json")

# =============================================================================
# BRAND CASE + STOPWORDS
# =============================================================================

BRAND_CASE = {
    # core
    "nexus dex":     "Nexus DEX",
    "verixia":       "Verixia",
    "wonderland":    "Wonderland",
    # solana ecosystem
    "jupiter":       "Jupiter",
    "raydium":       "Raydium",
    "orca":          "Orca",
    "meteora":       "Meteora",
    "phoenix":       "Phoenix",
    "lifinity":      "Lifinity",
    "kamino":        "Kamino",
    "raydium launchlab": "Raydium LaunchLab",
    # wallets
    "phantom":       "Phantom",
    "backpack":      "Backpack",
    "solflare":      "Solflare",
    "trust wallet":  "Trust Wallet",
    # comparison venues
    "coinbase":      "Coinbase",
    "binance":       "Binance",
    "robinhood":     "Robinhood",
    "kraken":        "Kraken",
    "uniswap":       "Uniswap",
    "dexscreener":   "Dexscreener",
    # chains
    "solana":        "Solana",
    "ethereum":      "Ethereum",
    "bitcoin":       "Bitcoin",
    "avalanche":     "Avalanche",
    "arbitrum":      "Arbitrum",
    "optimism":      "Optimism",
    "polygon":       "Polygon",
    "base":          "Base",
    "bsc":           "BSC",
    "sui":           "Sui",
    "aptos":         "Aptos",
    # bridges
    "wormhole":      "Wormhole",
    "debridge":      "deBridge",
    "allbridge":     "Allbridge",
    # tickers
    "btc":   "BTC",  "eth":   "ETH",  "sol":   "SOL",
    "usdc":  "USDC", "usdt":  "USDT", "bnb":   "BNB",
    # solana tokens
    "jup":   "JUP",  "ray":   "RAY",  "pyth":  "PYTH",  "jto": "JTO",
    # memes
    "hoppy":    "HOPPY",    "fartcoin": "FARTCOIN", "pepe":   "PEPE",
    "wif":      "WIF",      "bonk":     "BONK",     "popcat": "POPCAT",
    "mew":      "MEW",      "wen":      "WEN",      "bome":   "BOME",
    "myro":     "MYRO",     "ponke":    "PONKE",    "michi":  "MICHI",
    "trump":    "TRUMP",    "moodeng":  "MOODENG",  "goat":   "GOAT",
    "pnut":     "PNUT",     "doge":     "DOGE",     "shib":   "SHIB",
    "floki":    "FLOKI",    "fwog":     "FWOG",     "pengu":  "PENGU",
    "neiro":    "NEIRO",    "useless":  "USELESS",
    # brand tokens (x-suffix, Solana SPL tokens that track popular brands)
    "aaplx":  "AAPLx",  "tslax":  "TSLAx",  "nvdax":  "NVDAx",
    "msftx":  "MSFTx",  "googlx": "GOOGLx", "amznx":  "AMZNx",
    "metax":  "METAx",  "mstrx":  "MSTRx",  "nflxx":  "NFLXx",
    "spyx":   "SPYx",   "qqqx":   "QQQx",   "crclx":  "CRCLx",
    "hoodx":  "HOODx",  "coinx":  "COINx",  "orclx":  "ORCLx",
    "crmx":   "CRMx",
    # brand companies
    "apple":         "Apple",
    "tesla":         "Tesla",
    "nvidia":        "Nvidia",
    "microsoft":     "Microsoft",
    "google":        "Google",
    "alphabet":      "Alphabet",
    "amazon":        "Amazon",
    "meta":          "Meta",
    "netflix":       "Netflix",
    "microstrategy": "MicroStrategy",
    "circle":        "Circle",
    "oracle":        "Oracle",
    "salesforce":    "Salesforce",
    # acronyms
    "dex":   "DEX",
    "cex":   "CEX",
    "kyc":   "KYC",
    "spl":   "SPL",
    "nft":   "NFT",
    "dao":   "DAO",
    "defi":  "DeFi",
    "tvl":   "TVL",
    "lp":    "LP",
    "us":    "U.S.",
}

SMALL_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
    "or", "the", "to", "vs", "with"
}

STOPWORDS_FOR_VARIATIONS = {
    "is", "this", "a", "an", "the", "or", "and", "to", "for", "of", "in",
    "on", "by", "with", "from", "how", "what", "where", "best", "can", "i",
    "my", "your", "do", "does", "trade", "trading", "buy", "sell", "swap",
    "no", "kyc", "mobile", "app", "wallet", "only", "without", "verification",
    "signup", "account",
}

LOW_SIGNAL_VARIATION_WORDS = {
    "new", "top", "best", "low", "high", "trending", "viral", "cheapest",
}

# =============================================================================
# HUB COPY (v18.4)
# =============================================================================

HUB_INTROS = {
    "wonderland-memes": "Wonderland is the meme corner of Verixia. Trade HOPPY, FARTCOIN, PEPE, WIF, BONK, POPCAT, and the freshest Solana memecoins straight from your wallet. No KYC, no signup, no limits. Just ape from your phone and settle in USDC.",
    "live-signals": "Live signals surface what's actually moving on Solana right now — fresh launches, top gainers, volume leaders, and trending tokens. Pulled live from on-chain data so you see the heat before it shows up on Twitter.",
    "brand-tokens": "Brand tokens are Solana SPL tokens that track popular brands like Apple, Tesla, NVIDIA, Microsoft, and more. Trade AAPLx, TSLAx, NVDAx, MSFTx, GOOGLx, AMZNx, METAx, MSTRx, SPYx, QQQx, and others directly from your wallet. Settled in USDC, no broker account, no KYC, global access from a Solana wallet.",
    "solana-bridges": "Bridge into Solana from Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BNB Chain, Sui, Aptos, and more. Verixia plugs into Wormhole, deBridge, and Allbridge to route the best path. Land your tokens on Solana fast and start trading in seconds.",
    "solana-swaps": "Swap any Solana token with best-price routing across Jupiter, Raydium, Orca, Meteora, and other DEXes. Connect Phantom, Backpack, or Solflare, pick a token, and trade. No KYC, no signup, low slippage, sub-second blocks.",
    "no-kyc-trading": "No KYC, no accounts, no limits, no signup. Verixia is a self-custodial Solana DEX where your wallet is your identity. Swap memes, brand tokens, and SPL tokens straight from your wallet without ever sharing personal data.",
    "wallet-trading": "Trade entirely from your wallet. Phantom, Backpack, Solflare, or any major Solana wallet. Verixia never holds your funds, never asks for an account, and never custodies anything. Every trade settles on-chain from your wallet signature.",
    "whale-tracking": "See what whales, smart money, deployers, and KOLs are doing on Solana in real time. Built into Verixia so you can spot accumulation before the chart moves and follow the wallets that consistently get there early.",
    "token-launch": "Launch a Solana token from your wallet. No code, no KYC, no upfront fees. Deploy a memecoin or brand token, attach a bonding curve, and graduate to Raydium liquidity once you hit the threshold. All from your phone.",
    "how-to-guides": "Step-by-step guides for using Verixia from a Solana wallet. Covers swaps, bridging into Solana, buying brand tokens, trading Wonderland memes, launching tokens, and tracking whales. Built mobile-first.",
    "crypto-markets": "Verixia is the all-in-one Solana DeFi app. Swaps, brand tokens, Wonderland memes, cross-chain bridging, signals, whale tracking, token launches — all from your wallet, all on Solana, all without KYC.",
}

HUB_TITLES = {
    "wonderland-memes": "Wonderland Memes on Verixia: HOPPY, FARTCOIN, PEPE, WIF, BONK",
    "live-signals":     "Live Signals: Trending Solana Tokens, Fresh Launches, Top Gainers",
    "brand-tokens":     "Brand Tokens on Solana: AAPLx, TSLAx, NVDAx, SPYx, QQQx From Your Wallet",
    "solana-bridges":   "Bridge to Solana: From Ethereum, Base, Arbitrum, BNB, Sui, Aptos",
    "solana-swaps":     "Solana DEX Aggregator: Best Price Swaps, No KYC, Mobile-First",
    "no-kyc-trading":   "No KYC Trading on Solana: Swaps, Memes & Brand Tokens From Wallet",
    "wallet-trading":   "Wallet-Based Trading: Self-Custodial Solana DEX From Phantom or Backpack",
    "whale-tracking":   "Solana Whale Tracking: Smart Money, Deployers, KOL Wallets Live",
    "token-launch":     "Launch a Solana Token: No KYC, From Your Wallet, Mobile",
    "how-to-guides":    "Verixia How-To Guides: Swaps, Bridges, Brand Tokens, Memes, Launches",
    "crypto-markets":   "Verixia: All-In-One Solana DeFi App From Your Wallet",
}

HUB_META_DESCRIPTIONS = {
    "wonderland-memes": "Trade Wonderland memes on Verixia: HOPPY, FARTCOIN, PEPE, WIF, BONK, POPCAT. Self-custodial Solana DEX with no KYC, no signup, no limits, mobile-first.",
    "live-signals":     "Live signals on Verixia surface trending Solana tokens, fresh launches, top gainers, and volume leaders pulled from on-chain data in real time.",
    "brand-tokens":     "Trade Solana tokens that track popular brands: AAPLx, TSLAx, NVDAx, MSFTx, GOOGLx, SPYx, QQQx. From your wallet, settled in USDC, no broker account.",
    "solana-bridges":   "Bridge into Solana from Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BNB, Sui, Aptos. Wormhole, deBridge, and Allbridge routing built in.",
    "solana-swaps":     "Swap any Solana token on Verixia with best-price routing across Jupiter, Raydium, Orca, and Meteora. No KYC, no account, low slippage, mobile-first.",
    "no-kyc-trading":   "No KYC, no accounts, no limits trading on Verixia. Self-custodial Solana DEX where your wallet is your identity. Trade memes, brand tokens, and SPL tokens.",
    "wallet-trading":   "Self-custodial trading on Verixia from Phantom, Backpack, or Solflare. Your wallet is your account. Every trade settles on-chain with no deposit and no KYC.",
    "whale-tracking":   "Track Solana whales, smart money, memecoin insiders, deployer clusters, and KOL wallets on Verixia. See who is accumulating before the chart moves.",
    "token-launch":     "Launch a Solana token from your wallet on Verixia. No KYC, no code, no upfront fees. Bonding curve launchpad with automatic Raydium graduation.",
    "how-to-guides":    "Step-by-step Verixia guides for Solana swaps, bridging into Solana, buying brand tokens, trading Wonderland memes, launching tokens, and tracking whales.",
    "crypto-markets":   "Verixia is the all-in-one Solana DeFi app: swaps, brand tokens, Wonderland memes, cross-chain bridges, live signals, whale tracking, and token launches.",
}

HUB_KEY_FEATURES = {
    "wonderland-memes": [
        "Trade HOPPY, FARTCOIN, PEPE, WIF, BONK, POPCAT, and the freshest Solana memes",
        "Aggregated routing across Jupiter, Raydium, Orca, and Meteora for best price",
        "No KYC, no signup, no daily limits — your wallet is your account",
        "Mobile-first execution with one-tap buys and instant settlement",
    ],
    "live-signals": [
        "Live trending tokens pulled directly from on-chain Solana data",
        "Fresh launches surfaced as they hit minimum liquidity thresholds",
        "Top gainers and volume leaders updated continuously through the session",
        "Click any signal to swap from your wallet without leaving the feed",
    ],
    "brand-tokens": [
        "Solana SPL tokens that track popular brands: AAPLx, TSLAx, NVDAx, MSFTx, GOOGLx, AMZNx, METAx, MSTRx, NFLXx, SPYx, QQQx, CRCLx, HOODx, COINx, ORCLx, CRMx",
        "Trade directly from a Solana wallet, settled in USDC, fully on-chain",
        "Best-price routing across Jupiter, Raydium, and Orca for every trade",
        "Self-custodial — brand tokens live in your wallet alongside SOL and USDC",
    ],
    "solana-bridges": [
        "Bridge from Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BNB, Sui, Aptos, and 60+ chains",
        "Routed through Wormhole, deBridge, and Allbridge to find the fastest path",
        "USDC and major tokens land in your Solana wallet ready to trade",
        "Self-custodial throughout — no centralized bridge account or KYC",
    ],
    "solana-swaps": [
        "Best-price aggregation across Jupiter, Raydium, Orca, Meteora, Phoenix, Lifinity",
        "Swap any SPL token with low slippage and sub-second settlement",
        "Mobile-first interface from Phantom, Backpack, or Solflare",
        "Paste a contract address and trade in seconds without signup",
    ],
    "no-kyc-trading": [
        "No identity verification, no account creation, no document uploads",
        "Self-custodial — funds always under your control, no platform custody",
        "Covers Solana swaps, Wonderland memes, brand tokens, and cross-chain bridging",
        "Mobile-first, accessible from any major Solana wallet",
    ],
    "wallet-trading": [
        "Fully self-custodial across swaps, brand tokens, memes, and bridges",
        "Verixia never holds funds, never custodies, never freezes wallets",
        "Every trade settles on-chain from your wallet signature",
        "Works with Phantom, Backpack, Solflare, and other Solana wallets",
    ],
    "whale-tracking": [
        "Real-time tracking of top traders, early buyers, and deployer wallets",
        "Smart money flow analysis across memecoins and trending tokens",
        "Pre-pump buyer detection and sniper cluster identification",
        "KOL wallet monitoring and holder concentration breakdowns",
    ],
    "token-launch": [
        "Deploy a Solana token from your wallet with no code or KYC required",
        "Bonding curve launchpad with automatic Raydium graduation",
        "No upfront fees, no presale gatekeeping, no third-party platform",
        "Mobile-first launch flow accessible from Phantom or Backpack",
    ],
    "how-to-guides": [
        "Step-by-step walkthroughs for Solana swaps, bridges, memes, and brand tokens",
        "Wallet setup guides for Phantom, Backpack, and Solflare",
        "Token launch tutorials covering bonding curves and Raydium graduation",
        "Whale tracking and live signal interpretation guides",
    ],
    "crypto-markets": [
        "All-in-one Solana DeFi app: swaps, brand tokens, memes, bridges, signals, whales, launches",
        "No KYC, no accounts, no limits — your wallet is your identity",
        "Best-price routing across Jupiter, Raydium, Orca, Meteora, and more",
        "Mobile-first interface designed for Solana wallet users",
    ],
}

HUB_FAQS = {
    "wonderland-memes": [
        ("How do I buy a Wonderland meme like HOPPY or FARTCOIN?", "Connect a Solana wallet, search for the token by ticker, and swap from SOL or USDC. The trade routes through Jupiter, Raydium, Orca, and Meteora to find the best price across them all."),
        ("Are there limits on how much I can ape?", "No. There are no daily caps and no maximum trade size. Minimum trade amounts exist only because Solana transactions have a small gas cost, not because of any policy."),
        ("Can I trade new memecoins right after launch?", "Yes. As soon as a token has liquidity on a supported Solana DEX, Verixia picks it up automatically. You can swap into fresh launches the same minute they go live."),
        ("Does Verixia hold the memecoin in custody?", "No. Tokens land directly in your Solana wallet after the swap. Verixia never holds funds. Your wallet, your keys, your tokens."),
    ],
    "live-signals": [
        ("Where does the signals data come from?", "Directly from on-chain Solana activity. Fresh launches, top gainers, and volume leaders are pulled from live indexed pool and token data, not from a third-party aggregator."),
        ("Can I trade a signal directly from the feed?", "Yes. Tap any signal to open the swap interface pre-filled with the token. Connect your wallet, sign the swap, and the trade settles in seconds."),
    ],
    "brand-tokens": [
        ("What are brand tokens?", "Brand tokens are Solana SPL tokens that track popular brands like Apple, Tesla, NVIDIA, Microsoft, Google, Amazon, Meta, MicroStrategy, and others. They trade as standard SPL tokens on Solana DEXes."),
        ("Do I need a broker account or KYC?", "No. Brand tokens are SPL tokens. Connect a Solana wallet, fund it with USDC or SOL, and swap. There is no broker signup, no ID upload, and no centralized account at the protocol level."),
        ("How do I trade a brand token?", "Search for the ticker (AAPLx, TSLAx, NVDAx, etc.) inside Verixia and swap from USDC or SOL. The trade routes across Jupiter, Raydium, and Orca for best price and settles to your wallet in seconds."),
        ("Can I hold brand tokens in my Solana wallet?", "Yes. Once you buy, the brand token lives in your wallet alongside SOL, USDC, and any other SPL token. You can hold, swap, or transfer it like any other Solana token."),
    ],
    "solana-bridges": [
        ("Which chains can I bridge from to Solana?", "Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BNB Chain, Sui, Aptos, and 60+ others. Verixia routes through Wormhole, deBridge, and Allbridge to find the fastest path for each pair."),
        ("How long does a bridge take?", "Most bridges complete in a few minutes. Time varies by source chain finality. Once funds land on Solana, they are immediately tradable inside Verixia."),
        ("Is the bridge custodial?", "No. Bridges are smart-contract based and Verixia doesn't take custody at any step. Funds move from your source wallet to your Solana wallet through the bridge protocol's contracts."),
    ],
    "solana-swaps": [
        ("How is Verixia different from Jupiter directly?", "Verixia aggregates Jupiter, Raydium, Orca, Meteora, and other DEXes to find the best price across all of them in one transaction. You also get integrated brand tokens, Wonderland memes, bridging, and signals."),
        ("Do I need to switch wallets?", "No. The same Solana wallet handles every swap on Verixia. Phantom, Backpack, Solflare — pick one and use it across everything."),
    ],
    "no-kyc-trading": [
        ("Is no-KYC trading legal?", "Self-custodial wallet trading is legal in most jurisdictions. Tax and reporting obligations may still apply depending on where you live. Verixia doesn't provide tax or legal advice."),
        ("What if I lose access to my wallet?", "Because Verixia is non-custodial, your wallet's seed phrase is the only recovery method. Back it up securely. Verixia cannot recover funds for you."),
    ],
    "wallet-trading": [
        ("Does Verixia ever hold my funds?", "No. Funds stay in your wallet between trades. Each trade is signed from your wallet and settles on-chain. Verixia is just an interface to Solana DEX liquidity."),
        ("What happens if Verixia goes offline?", "Your funds remain in your wallet because Verixia never custodies them. You retain full control regardless of the platform's status."),
    ],
    "whale-tracking": [
        ("What counts as smart money?", "Wallets with consistent profitable trades, early entries on tokens that pumped, deployer clusters with track records, and KOL wallets. Verixia surfaces these wallets and their current positions in real time."),
        ("Can I follow specific wallets?", "Yes. The whale tracker lets you follow individual wallets and get alerts when they buy, sell, or accumulate a specific token."),
    ],
    "token-launch": [
        ("Do I need to write code to launch a token?", "No. The launchpad is no-code. You name the token, set basic parameters like supply and ticker, and deploy from your wallet."),
        ("How does Raydium graduation work?", "Once a token's bonding curve hits the graduation threshold, liquidity is automatically migrated to a Raydium pool. From there it trades as a standard SPL token across all Solana DEXes."),
    ],
    "how-to-guides": [
        ("Where should I start if I'm new to Solana wallets?", "Start with the wallet setup guide. It walks through creating a Phantom or Backpack wallet, funding it with SOL, and connecting to Verixia for your first swap."),
        ("Do the guides cover mobile?", "Yes. Every guide is mobile-first because the entire Verixia interface is designed for mobile execution. The flows shown in the guides work the same on iOS and Android."),
    ],
    "crypto-markets": [
        ("What can I do on Verixia?", "Swap any Solana token, trade brand tokens like AAPLx and TSLAx, ape Wonderland memes, bridge in from 60+ chains, track whales, launch your own token, and follow live signals — all from your wallet."),
        ("Do I need an account or KYC?", "No. Verixia is fully self-custodial. Connect a Solana wallet, sign a transaction, and trade. There is no signup, no KYC, and no centralized account."),
    ],
}

GENERIC_FAQS = [
    ("Do I need an account or KYC to use Verixia?", "No. Verixia is fully self-custodial. Connect a Solana wallet, sign a transaction, and trade. There is no signup, no KYC, and no centralized account."),
    ("Which wallets are supported?", "Phantom, Backpack, Solflare, and other major Solana wallets work with Verixia. You sign each trade from your wallet and funds stay in your wallet between trades."),
]

HUB_GET_STARTED_STEPS = {
    "wonderland-memes": [
        "Install Phantom, Backpack, or Solflare and fund it with SOL or USDC.",
        "Open the Wonderland tab in Verixia and pick a meme (HOPPY, FARTCOIN, PEPE, WIF, etc.).",
        "Tap buy, review the route, and sign the swap from your wallet. The token lands in your wallet in seconds.",
    ],
    "live-signals": [
        "Connect a Solana wallet (Phantom, Backpack, or Solflare) funded with USDC or SOL.",
        "Open the signals feed and browse trending tokens, fresh launches, and top gainers.",
        "Tap any signal to open the swap pre-filled, then sign the trade from your wallet.",
    ],
    "brand-tokens": [
        "Connect a Solana wallet funded with USDC or SOL.",
        "Search for a brand token ticker (AAPLx, TSLAx, NVDAx, SPYx, QQQx, etc.) inside Verixia.",
        "Review the best-price route across Jupiter, Raydium, and Orca, then sign the swap from your wallet.",
    ],
    "solana-bridges": [
        "Open the bridge tab and pick your source chain (Ethereum, Base, Arbitrum, BNB, Sui, etc.).",
        "Connect the source wallet and pick the token and amount to bridge to Solana.",
        "Verixia routes through Wormhole, deBridge, or Allbridge automatically. Sign the bridge transaction and your tokens land in your Solana wallet.",
    ],
    "solana-swaps": [
        "Connect a Solana wallet funded with SOL or USDC.",
        "Pick a token from the list or paste a contract address.",
        "Review the route across Jupiter, Raydium, Orca, and Meteora, then sign the swap from your wallet.",
    ],
    "no-kyc-trading": [
        "Install a Solana wallet (Phantom, Backpack, or Solflare).",
        "Fund the wallet with SOL or USDC from any source you control.",
        "Connect to Verixia and trade swaps, brand tokens, memes, or bridges. No identity check required.",
    ],
    "wallet-trading": [
        "Install a Solana wallet and back up your seed phrase securely.",
        "Fund the wallet with SOL or USDC from any source you control.",
        "Connect to Verixia. Every trade is signed from your wallet and settles on-chain.",
    ],
    "whale-tracking": [
        "Open the whale tracker section inside Verixia.",
        "Browse top traders, early buyers, deployer wallets, and KOLs by category.",
        "Follow individual wallets or set alerts for specific accumulation patterns.",
    ],
    "token-launch": [
        "Connect a Solana wallet funded with a small amount of SOL for the deployment.",
        "Open the launchpad, set the token name, ticker, and supply.",
        "Sign the deployment transaction from your wallet. The bonding curve goes live immediately and graduates to Raydium automatically once it hits the threshold.",
    ],
    "how-to-guides": [
        "Start with the wallet setup guide if you're new to Solana.",
        "Pick the guide matching your goal (swap, bridge, brand tokens, memes, launch).",
        "Follow the step-by-step walkthrough using a small test amount first.",
    ],
    "crypto-markets": [
        "Install a Solana wallet (Phantom, Backpack, or Solflare) and fund it with SOL or USDC.",
        "Open Verixia and pick what you want to do: swap, ape memes, buy brand tokens, bridge in, or launch a token.",
        "Every trade is signed from your wallet and settles on-chain in seconds.",
    ],
}

HUB_HOW_IT_WORKS = {
    "wonderland-memes": "Wonderland is the meme tab inside Verixia. When you tap buy on a token, the trade routes through Jupiter, Raydium, Orca, and Meteora to find the lowest-slippage path right now. Your wallet signs one transaction and the token lands in your wallet in seconds.",
    "live-signals": "The signals feed pulls directly from on-chain Solana activity. Fresh launches, top gainers, and volume leaders are surfaced as the indexer sees them. Tap any signal and the swap interface pre-fills with the token so you can trade in one tap.",
    "brand-tokens": "Brand tokens are standard Solana SPL tokens. When you swap into one, the trade routes across Jupiter, Raydium, and Orca to find the best price. The token settles directly to your wallet, where it lives alongside your SOL, USDC, and any other SPL token. You can hold it, swap it, or transfer it like any other Solana asset.",
    "solana-bridges": "Bridges move tokens from a source chain into your Solana wallet using smart contracts on both sides. Verixia routes through Wormhole, deBridge, or Allbridge depending on the source chain and token. You sign on the source chain, the bridge protocol mints or releases the equivalent on Solana, and the tokens land in your Solana wallet ready to trade.",
    "solana-swaps": "Verixia queries Jupiter, Raydium, Orca, Meteora, Phoenix, and Lifinity for the best price on your swap. The selected route is executed in a single transaction signed from your wallet. You get the best available price across all the major Solana liquidity sources without checking each one manually.",
    "no-kyc-trading": "Every trade on Verixia settles from your wallet signature. There is no off-chain account, no identity check, and no custodial wrapper between you and the Solana DEX liquidity. The platform is just an interface — your wallet is your account.",
    "wallet-trading": "Verixia is fully non-custodial. Your wallet holds the funds, signs the transactions, and receives the proceeds. The platform never takes custody, cannot freeze, pause, or reverse your trades, and has no way to access your funds.",
    "whale-tracking": "The whale tracker indexes on-chain trading activity across Solana, ranks wallets by profitability and timing, and surfaces patterns like accumulation, deployer clusters, and sniper behavior. Data is pulled live from indexed transactions.",
    "token-launch": "The launchpad deploys an SPL token, attaches a bonding curve for early price discovery, and automatically migrates liquidity to a Raydium pool once the graduation threshold is hit. Every step is signed from your wallet.",
    "how-to-guides": "Each guide walks through one specific Verixia workflow end-to-end. Steps cover wallet setup, funding, the action itself, and what to expect at each stage. All guides are mobile-first because the entire interface is designed for mobile execution.",
    "crypto-markets": "Verixia is built on Solana for sub-second blocks and cents-per-trade fees. The app surfaces Jupiter, Raydium, Orca, and other Solana DEXes through a single interface, plus its own integrations for bridges (Wormhole, deBridge, Allbridge), signals, whale tracking, brand tokens, Wonderland memes, and the launchpad. Everything settles from your wallet.",
}

HUB_TARGETING = {
    "wonderland-memes": "Wonderland is for degens, memecoin apes, and anyone who wants to grab fresh Solana launches before they hit Twitter. Mobile-first, fast execution, no KYC friction.",
    "live-signals": "Signals are for traders who want to see what's actually moving on-chain rather than scrolling through Twitter or Discord. Useful for spotting fresh launches and following accumulation in real time.",
    "brand-tokens": "Brand tokens are for crypto-native investors who want exposure to popular brands like Apple, Tesla, and NVIDIA from their Solana wallet alongside SOL and USDC — without opening a brokerage account or going through KYC.",
    "solana-bridges": "Bridges are for users coming into Solana from Ethereum, Base, Arbitrum, BNB, Sui, or any other major chain. Useful when you want to consolidate liquidity on Solana or chase opportunities that live on Solana DeFi.",
    "solana-swaps": "Swaps are the core of Verixia and useful for anyone trading SPL tokens. Best-price aggregation matters most for memes, low-cap tokens, and any pair where liquidity is fragmented across multiple DEXes.",
    "no-kyc-trading": "No-KYC trading is for privacy-focused users, users in jurisdictions with limited centralized exchange access, and crypto-native users who prefer self-custody as a default.",
    "wallet-trading": "Wallet-trading is for users who have been burned by centralized exchange custody issues, privacy-focused traders, and Solana-native users who want everything to settle from their own wallet.",
    "whale-tracking": "Whale tracking is for memecoin traders, smart-money followers, and analysts who want to see accumulation, deployer behavior, or early-buyer patterns before public visibility.",
    "token-launch": "Token launching is for memecoin creators, community founders, and people testing token ideas without paying upfront launchpad fees or going through KYC gatekeeping.",
    "how-to-guides": "Guide readers include new Solana wallet users, traders migrating from centralized exchanges, and existing Verixia users learning a specific feature for the first time.",
    "crypto-markets": "Verixia is for Solana-native traders who want one app for everything: swaps, brand tokens, memes, bridges, signals, whales, and launches. Mobile-first, no KYC, wallet-based.",
}

INTRO_FALLBACK = (
    "This hub groups together related Verixia pages so you can review features, compare workflows, and quickly navigate to the most relevant Solana DeFi topics in this category."
)

META_FALLBACK = (
    "Explore Verixia features, compare related Solana DeFi workflows, and learn how each one runs from a self-custodial wallet."
)

# =============================================================================
# CONTEXT HINT MAPS (v18.4 scrubbed)
# =============================================================================

GENERIC_ENTITY_WORDS = {
    "trade", "trading", "trader", "swap", "swaps", "buy", "sell",
    "mobile", "app", "wallet", "wallets", "account",
    "no", "kyc", "signup", "without", "verification", "from", "to", "with",
    "for", "on", "in", "is", "a", "an", "the", "this", "what", "how", "where",
    "why", "can", "should", "do", "does", "best", "new", "top", "low", "high",
    "trending", "viral", "cheapest", "live", "price", "open",
}

CHANNEL_HINTS = {
    "mobile":   "mobile-first",
    "app":      "mobile-first",
    "wallet":   "wallet-based",
    "phantom":  "wallet-based",
    "backpack": "wallet-based",
    "solflare": "wallet-based",
    "solana":   "Solana-native",
    "spl":      "Solana-native",
}

INTENT_HINTS = {
    "kyc":          "no-KYC access",
    "signup":       "no-signup access",
    "account":      "no-account access",
    "verification": "no-verification access",
    "swap":         "Solana swaps",
    "swaps":        "Solana swaps",
    "buy":          "buying SPL tokens",
    "bridge":       "cross-chain bridging into Solana",
    "bridges":      "cross-chain bridging into Solana",
    "whale":        "whale and smart-money tracking",
    "smart":        "whale and smart-money tracking",
    "launch":       "token launching",
    "launchpad":    "token launching",
    "memecoin":     "Solana memecoin trading",
    "meme":         "Solana memecoin trading",
    "wonderland":   "Wonderland meme trading",
    "stocks":       "brand-token trading",
    "stock":        "brand-token trading",
    "brand":        "brand-token trading",
    "tokenized":    "brand-token trading",
    "signals":      "live token discovery",
    "trending":     "live token discovery",
}

GENERIC_COMPARISON_POINTS = [
    (
        "Verixia is self-custodial and wallet-based. Funds stay in your wallet between trades.",
        "Centralized exchanges custody your funds and can freeze, pause, or restrict withdrawals."
    ),
    (
        "Verixia requires no signup, no KYC, and no document upload. Connect a wallet and trade.",
        "Centralized exchanges require account creation, identity verification, and often block users by geography."
    ),
    (
        "Verixia settles every trade on-chain from your wallet signature.",
        "Centralized exchanges settle internally on an off-chain ledger you cannot independently verify."
    ),
]

HUB_COMPARISON_POINTS = {
    "wonderland-memes": [
        (
            "Trade HOPPY, FARTCOIN, and fresh launches the same minute they hit Solana DEX liquidity.",
            "Centralized exchanges usually wait weeks or months to list memecoins, if they list them at all."
        ),
        (
            "No KYC, no signup, no daily limits — ape from your wallet directly.",
            "Centralized memecoin trading requires KYC, account setup, and often geographic eligibility checks."
        ),
    ],
    "live-signals": [
        (
            "Signals pulled directly from on-chain Solana activity in real time.",
            "Twitter and Discord signals are delayed, biased, and often paid promotion."
        ),
        (
            "Tap any signal to swap from your wallet without leaving the feed.",
            "Following a Twitter signal still requires opening a wallet app and finding the token manually."
        ),
    ],
    "brand-tokens": [
        (
            "Brand tokens settle to your Solana wallet alongside SOL and USDC. Trade 24/7 in seconds.",
            "Brokerage stocks sit in a broker account, settle T+1, and trade only during U.S. market hours."
        ),
        (
            "No broker account, no KYC at the protocol level, no minimum balance.",
            "Brokerages require account approval, identity verification, and often a minimum funding amount."
        ),
        (
            "Self-custodial — brand tokens live in your wallet, not in a broker's system that can be restricted.",
            "Brokerage accounts are subject to account holds, platform policies, and can be closed at the broker's discretion."
        ),
    ],
    "solana-bridges": [
        (
            "Bridges run through smart contracts — Verixia never takes custody at any point in the route.",
            "Centralized bridge services hold funds during the bridge window and can freeze or delay transfers."
        ),
        (
            "Bridges directly into your Solana wallet, ready to trade in seconds.",
            "Centralized exchange bridges require depositing on the source chain and withdrawing on Solana, often with hold periods."
        ),
    ],
    "solana-swaps": [
        (
            "Best price aggregated across Jupiter, Raydium, Orca, and Meteora in one transaction.",
            "Centralized exchange swap pricing depends on their internal order book and listed pairs."
        ),
        (
            "No KYC, no signup, instant settlement to your wallet.",
            "Centralized exchange swaps require account creation and may restrict withdrawals."
        ),
    ],
    "no-kyc-trading": [
        (
            "Verixia trades from your wallet without identity verification or document upload.",
            "Centralized exchanges require KYC at signup and often re-KYC for higher limits or specific products."
        ),
        (
            "Your wallet remains the only source of account access. No personal data is stored.",
            "Centralized exchange access depends on their account systems and stored identity records."
        ),
    ],
    "wallet-trading": [
        (
            "Funds stay in your wallet between trades. Verixia never custodies or holds them.",
            "Centralized exchanges custody your funds and can freeze, restrict, or pause access."
        ),
        (
            "Every trade settles on-chain from your wallet signature, fully transparent.",
            "Centralized trades settle on an internal ledger you cannot independently verify."
        ),
    ],
    "whale-tracking": [
        (
            "Real-time on-chain whale and smart-money tracking based on indexed Solana activity.",
            "CEX whale tracking is impossible because their order books are off-chain and opaque."
        ),
        (
            "Follow specific wallets, deployer clusters, or sniper patterns from the same interface you trade in.",
            "Most third-party trackers require subscriptions and live separately from the trading interface."
        ),
    ],
    "token-launch": [
        (
            "Launch a token from your wallet with no code, no KYC, and no upfront fees.",
            "Centralized exchange listings require legal review, fees, and weeks or months of process."
        ),
        (
            "Bonding curve launchpad auto-graduates to Raydium liquidity once the threshold is reached.",
            "Third-party launchpads often gate access, require fees, or take a meaningful percentage of supply."
        ),
    ],
    "how-to-guides": [
        (
            "Each guide walks through a specific Verixia workflow from wallet setup through trade execution.",
            "Most centralized exchange tutorials assume you've already completed KYC and funded an account."
        ),
        (
            "Guides are mobile-first because the entire interface is designed for mobile execution.",
            "Centralized exchange guides often default to desktop UIs that differ from their mobile apps."
        ),
    ],
    "crypto-markets": [
        (
            "Verixia is an all-in-one Solana DeFi app: swaps, brand tokens, memes, bridges, signals, whales, launches.",
            "Most centralized exchanges focus on spot pairs and add other products through separate tabs or apps."
        ),
        (
            "Self-custodial throughout. Wallet is your account across every product surface.",
            "Centralized exchanges custody funds and require account-based access for every product."
        ),
    ],
}

HUB_SCENARIO_EXAMPLES = {
    "wonderland-memes": [
        "A degen wants to ape into a fresh Solana memecoin within minutes of launch.",
        "A trader sees a trending Wonderland meme on the signals feed and wants to swap in immediately.",
        "A user wants to swap between HOPPY, FARTCOIN, and WIF from their phone without opening a CEX.",
    ],
    "live-signals": [
        "A trader wants to see which Solana tokens are pumping right now without scrolling Twitter.",
        "A user wants to spot fresh launches the moment they hit minimum liquidity.",
        "An analyst wants to see top gainers and volume leaders in one feed.",
    ],
    "brand-tokens": [
        "A crypto-native investor wants Apple and Nvidia exposure in their Solana wallet alongside SOL and USDC.",
        "A user wants to swap between AAPLx, TSLAx, and NVDAx without leaving their Solana wallet.",
        "A trader wants to buy MSTRx and SPYx from USDC in one tap without a broker account.",
    ],
    "solana-bridges": [
        "A user wants to move USDC from Ethereum to Solana to start trading Wonderland memes.",
        "A trader is consolidating liquidity from Arbitrum, Base, and BNB into one Solana wallet.",
        "A user wants to bridge SOL or USDC from Sui or Aptos to access Solana DeFi opportunities.",
    ],
    "solana-swaps": [
        "A user wants the best price on a USDC-to-SOL swap without checking three aggregators manually.",
        "A trader wants to swap into a freshly listed SPL token without leaving the Verixia interface.",
        "A mobile user wants low-slippage swaps with one-tap execution from their wallet.",
    ],
    "no-kyc-trading": [
        "A user in a jurisdiction with limited CEX access wants to trade Solana tokens without KYC.",
        "A privacy-focused trader wants to swap memes, brand tokens, and SPL tokens without sharing identity documents.",
        "A user burned by past KYC leaks wants to keep personal data out of the trading flow entirely.",
    ],
    "wallet-trading": [
        "A user wants all trading activity to settle from their wallet without centralized custody.",
        "A privacy-focused trader wants every trade to be inspectable on-chain.",
        "A user who lost funds in past exchange failures wants self-custody as the default.",
    ],
    "whale-tracking": [
        "A memecoin trader wants to see which wallets bought a token before its last pump.",
        "An analyst wants to track deployer clusters launching new tokens this week.",
        "A trader wants alerts when known smart-money wallets accumulate a specific token.",
    ],
    "token-launch": [
        "A creator wants to deploy a Wonderland memecoin without paying a third-party launchpad.",
        "A community wants to launch a token from a single wallet without code or KYC.",
        "A user wants to test a token concept with a small bonding-curve launch first.",
    ],
    "how-to-guides": [
        "A new Solana user wants to walk through their first swap step by step.",
        "A CEX-native trader wants a clear guide to opening their first wallet-based swap.",
        "A creator wants a guide to launching a Wonderland meme and graduating to Raydium.",
    ],
    "crypto-markets": [
        "A user wants one Solana app for swaps, brand tokens, memes, and bridges.",
        "A mobile-first trader wants all Verixia features accessible from their wallet.",
        "A Solana-native user wants to consolidate their workflow into a single self-custodial app.",
    ],
}

GENERIC_SCENARIO_EXAMPLES = [
    "A user wants to skip KYC and trade Solana tokens directly from a wallet they already control.",
    "A trader wants swaps, brand tokens, memes, bridges, and signals in one mobile-first interface.",
    "A self-custody-focused user wants every trade to settle on-chain.",
    "A mobile-first user wants the same interface for everything they do on Solana DeFi.",
]

COMMON_SCENARIO_TEMPLATES = {
    "memes": [
        "A degen wants to ape into a fresh Solana memecoin minutes after launch.",
        "A trader wants to swap between trending Wonderland memes from their phone.",
        "A user wants to grab a low-cap token before it hits Twitter.",
    ],
    "signals": [
        "A user wants to see what's actually pumping on Solana right now.",
        "A trader wants to spot fresh launches as they hit liquidity.",
        "An analyst wants volume leaders and top gainers in one feed.",
    ],
    "brands": [
        "A crypto-native investor wants brand-token exposure (Apple, Tesla, NVIDIA) inside their Solana wallet.",
        "A user wants to swap USDC into AAPLx, TSLAx, or NVDAx without a broker account.",
        "A trader wants to hold and swap brand tokens like any other SPL token.",
    ],
    "bridges": [
        "A user wants to move USDC from Ethereum to Solana to start trading.",
        "A trader wants to consolidate liquidity from Base, Arbitrum, or BNB into Solana.",
        "A user wants to bridge from Sui or Aptos to access Solana DeFi.",
    ],
    "swap": [
        "A user wants the best price on a token swap without checking three aggregators manually.",
        "A trader wants to swap into a new memecoin within minutes of liquidity going live.",
        "A mobile user wants low-slippage swaps without leaving their wallet flow.",
    ],
    "whale": [
        "A trader wants to see which wallets bought a token before its last pump.",
        "An analyst wants to track deployer wallets and identify clustered launches.",
        "A user wants alerts when known smart money accumulates a specific asset.",
    ],
    "launch": [
        "A creator wants to deploy a memecoin without paying a third-party launchpad.",
        "A community wants to launch a Wonderland meme with a bonding curve.",
        "A user wants to test a token concept without going through KYC or upfront fees.",
    ],
    "wallet": [
        "A user wants every trade to settle from their wallet without custodial wrappers.",
        "A privacy-focused trader wants to keep all trading activity on-chain and inspectable.",
        "A user burned by centralized exchange failures wants self-custody as the default.",
    ],
    "guide": [
        "A new user needs a step-by-step walkthrough for their first wallet-based trade.",
        "A CEX-native trader wants a clear path from account-based trading to wallet-based trading.",
        "A creator wants a guide to launching and graduating their first Solana token.",
    ],
    "general": [
        "A user wants to skip KYC and trade Solana tokens from a wallet they already control.",
        "A trader wants swaps, brand tokens, memes, and bridges in one mobile-first interface.",
        "A self-custody-focused user wants every trade to settle on-chain.",
    ],
}


# =============================================================================
# UTILITIES
# =============================================================================

def compact_spaces(text):
    return re.sub(r"\s+", " ", str(text)).strip()


def normalize_keyword(text):
    return compact_spaces(str(text).lower())


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", normalize_keyword(text)).strip("-")


def keyword_tokens(text):
    return set(normalize_keyword(text).replace("-", " ").split())


def normalize_term_tokens(text):
    return set(normalize_keyword(text).replace("-", " ").split())


def apply_brand_case(text):
    result = f" {str(text)} "
    for raw, proper in sorted(BRAND_CASE.items(), key=lambda x: len(x[0]), reverse=True):
        pattern = r"(?<![a-z0-9])" + re.escape(raw) + r"(?![a-z0-9])"
        result = re.sub(pattern, proper, result, flags=re.IGNORECASE)
    return compact_spaces(result)


def title_case(text):
    words = normalize_keyword(text).split()
    titled_words = []
    for i, word in enumerate(words):
        if i > 0 and word in SMALL_WORDS:
            titled_words.append(word)
        else:
            titled_words.append(word.capitalize())
    return apply_brand_case(" ".join(titled_words))


def escape_html(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def trim_meta_description(text, minimum=110, maximum=165):
    text = compact_spaces(text)
    if len(text) <= maximum:
        return text
    truncated = text[: maximum + 1]
    cut_points = [
        truncated.rfind(". "),
        truncated.rfind("; "),
        truncated.rfind(", "),
        truncated.rfind(" "),
    ]
    valid_cuts = [point for point in cut_points if point > minimum]
    if valid_cuts:
        cut = max(valid_cuts)
        text = truncated[:cut].rstrip(" ,;.")
    else:
        text = truncated[:maximum].rstrip(" ,;.")
    return text + "."


def build_canonical(slug):
    # Hubs are served from swap.verixiaapps.com/<slug>/ (same origin as the
    # approved swap dApp).
    return f"{SWAP_SITE}/{slug}/"


def page_path(slug):
    return os.path.join(OUTPUT_DIR, slug, "index.html")


def page_exists(slug):
    return os.path.exists(page_path(slug))


def iter_match_terms(match_terms):
    if isinstance(match_terms, str):
        return [match_terms]
    if isinstance(match_terms, dict):
        values = []
        for value in match_terms.values():
            if isinstance(value, (list, tuple, set)):
                values.extend(str(v) for v in value if str(v).strip())
            elif str(value).strip():
                values.append(str(value))
        return values
    if isinstance(match_terms, (list, tuple, set)):
        return [str(term) for term in match_terms if str(term).strip()]
    return [str(match_terms)] if str(match_terms).strip() else []


def load_keywords():
    if not os.path.exists(KEYWORDS_FILE):
        return []
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        return list(dict.fromkeys(normalize_keyword(line) for line in f if line.strip()))


def matches_cluster(keyword, match_terms):
    kw_norm   = normalize_keyword(keyword)
    kw_tokens = keyword_tokens(keyword)
    kw_joined = f" {kw_norm.replace('-', ' ')} "

    for term in iter_match_terms(match_terms):
        term_norm   = normalize_keyword(term)
        term_tokens = normalize_term_tokens(term)
        term_joined = f" {term_norm.replace('-', ' ')} "

        if term_tokens and term_tokens.issubset(kw_tokens):
            return True
        if term_joined.strip() and term_joined in kw_joined:
            return True

    return False


def score_keyword(keyword, hub_terms):
    kw        = normalize_keyword(keyword)
    kw_tokens = keyword_tokens(kw)
    score     = 0

    for term in iter_match_terms(hub_terms):
        term_tokens = normalize_term_tokens(term)
        if term_tokens and term_tokens.issubset(kw_tokens):
            score += 5

    if "no" in kw_tokens and "kyc" in kw_tokens:
        score += 3
    if "wallet" in kw_tokens or "mobile" in kw_tokens:
        score += 2
    if {"buy", "swap", "trade"} & kw_tokens:
        score += 2
    if "wonderland" in kw_tokens or "meme" in kw_tokens or "memecoin" in kw_tokens:
        score += 3
    if "bridge" in kw_tokens or "cross" in kw_tokens:
        score += 3
    if "brand" in kw_tokens or any(t.endswith("x") and t[:-1].isalpha() and len(t) >= 4 for t in kw_tokens):
        score += 3
    if kw.startswith("how to ") or kw.startswith("where to "):
        score += 1

    return (-score, len(kw), kw)


def dedupe_cluster_keywords(cluster_keywords):
    deduped    = []
    seen_slugs = set()
    for keyword in cluster_keywords:
        slug = slugify(keyword)
        if slug and slug not in seen_slugs:
            deduped.append(keyword)
            seen_slugs.add(slug)
    return deduped


def clean_display_keyword(keyword):
    cleaned = normalize_keyword(keyword)
    cleaned = re.sub(r"^\s*how\s+to\s+", "", cleaned)
    cleaned = re.sub(r"^\s*where\s+to\s+", "", cleaned)
    cleaned = re.sub(r"^\s*can\s+i\s+", "", cleaned)
    cleaned = re.sub(r"^\s*best\s+place\s+to\s+", "", cleaned)
    cleaned = re.sub(r"\s+no\s+kyc$", "", cleaned)
    cleaned = re.sub(r"\s+mobile$", "", cleaned)
    cleaned = re.sub(r"\s+app$", "", cleaned)
    cleaned = compact_spaces(cleaned)
    return title_case(cleaned)


def build_related_link_items(cluster_keywords):
    items = []
    seen  = set()
    for keyword in cluster_keywords:
        slug = slugify(keyword)
        if not slug or slug in seen or not page_exists(slug):
            continue
        seen.add(slug)
        label = clean_display_keyword(keyword)
        items.append({
            "slug":   slug,
            "title":  label,
            "href":   f"/{slug}/",
            "anchor": label,
        })
    return items


def build_related_links_html(link_items):
    return "\n".join(
        f'<li><a href="{escape_html(item["href"])}">{escape_html(item["anchor"])}</a></li>'
        for item in link_items
    )


def extract_variation_label(keyword, hub_terms):
    cleaned = normalize_keyword(keyword).replace("-", " ")
    cleaned = re.sub(r"^\s*how\s+to\s+", "", cleaned)
    cleaned = re.sub(r"^\s*where\s+to\s+", "", cleaned)
    cleaned = re.sub(r"^\s*can\s+i\s+", "", cleaned)
    cleaned = compact_spaces(cleaned)

    removable_terms = sorted(
        [normalize_keyword(term).replace("-", " ") for term in iter_match_terms(hub_terms) if normalize_keyword(term)],
        key=len,
        reverse=True,
    )
    for term in removable_terms:
        cleaned = re.sub(rf"\b{re.escape(term)}\b", " ", cleaned)

    original_words = cleaned.split()
    words = []
    for word in original_words:
        if word in STOPWORDS_FOR_VARIATIONS:
            continue
        if word in LOW_SIGNAL_VARIATION_WORDS and len(original_words) == 1:
            continue
        words.append(word)

    cleaned = compact_spaces(" ".join(words))
    if not cleaned or len(cleaned) < 3:
        return ""
    return title_case(cleaned)


def build_top_topics_html(cluster_keywords, hub_terms):
    counter = Counter()
    for keyword in cluster_keywords:
        label = extract_variation_label(keyword, hub_terms)
        if label:
            counter[label] += 1
    top_items = [label for label, _ in counter.most_common(TOP_TOPICS_COUNT)]
    if not top_items:
        return ""
    items_html = "\n".join(f"<li>{escape_html(item)}</li>" for item in top_items)
    return f"""
<section aria-labelledby="variations-heading">
<h2 id="variations-heading">Popular Topics In This Category</h2>
<p>These are the most common themes and search patterns across the related pages in this hub.</p>
<ul>
{items_html}
</ul>
</section>
""".strip()


def build_key_features_html(hub_slug):
    bullets = HUB_KEY_FEATURES.get(hub_slug, [
        "Self-custodial trading from your Solana wallet, no centralized account required",
        "No KYC, no signup, no document upload, no daily limits",
        "Mobile-first interface designed for fast execution",
        "Best-price routing and on-chain settlement for every trade",
    ])
    return "\n".join(f"<li>{escape_html(bullet)}</li>" for bullet in bullets)


def build_related_topics_html(match_terms):
    cleaned_terms = []
    seen = set()
    for term in iter_match_terms(match_terms):
        label = title_case(str(term).replace("-", " "))
        key = normalize_keyword(label)
        if key and key not in seen:
            seen.add(key)
            cleaned_terms.append(label)
    if not cleaned_terms:
        return ""
    items_html = "\n".join(
        f"<li>{escape_html(item)}</li>"
        for item in cleaned_terms[:MAX_RELATED_TOPICS]
    )
    return f"""
<section aria-labelledby="related-topics-heading">
<h2 id="related-topics-heading">Related Topics In This Hub</h2>
<p>These terms define the category and show the types of tokens, assets, and workflows this hub is built around.</p>
<ul>
{items_html}
</ul>
</section>
""".strip()


def build_get_started_html(hub_slug):
    steps = HUB_GET_STARTED_STEPS.get(hub_slug, [
        "Install a Solana wallet (Phantom, Backpack, or Solflare) and back up the seed phrase.",
        "Fund the wallet with SOL or USDC from any source you control.",
        "Connect to Verixia and start trading. No signup, no KYC, no deposit required.",
    ])
    items_html = "\n".join(f"<li>{escape_html(step)}</li>" for step in steps)
    return f"""
<section aria-labelledby="get-started-heading">
<h2 id="get-started-heading">How To Get Started</h2>
<p>These are the steps to start using this category from a Solana wallet.</p>
<ol>
{items_html}
</ol>
</section>
""".strip()


def build_how_it_works_html(hub_slug):
    text = HUB_HOW_IT_WORKS.get(
        hub_slug,
        "Verixia settles every trade on-chain from your wallet signature. Your funds remain in your wallet, the platform never takes custody, and all activity is visible and verifiable on-chain."
    )
    return f"""
<section aria-labelledby="how-it-works-heading">
<h2 id="how-it-works-heading">How This Works</h2>
<p>{escape_html(text)}</p>
</section>
""".strip()


def build_who_targeted_html(hub_slug):
    text = HUB_TARGETING.get(
        hub_slug,
        "This hub is useful for Solana-native users, mobile-first traders, and anyone who wants to use DeFi without going through a centralized exchange or completing KYC."
    )
    return f"""
<section aria-labelledby="targeting-heading">
<h2 id="targeting-heading">Who This Is For</h2>
<p>{escape_html(text)}</p>
</section>
""".strip()


def get_faqs_for_hub(hub_slug):
    faqs = list(HUB_FAQS.get(hub_slug, []))
    if len(faqs) < 2:
        faqs.extend(GENERIC_FAQS[: max(0, 2 - len(faqs))])
    return faqs[:MAX_FAQS]


def build_faq_html(hub_slug):
    blocks = []
    for question, answer in get_faqs_for_hub(hub_slug):
        blocks.append(
            f'<div class="faq-item"><h3>{escape_html(question)}</h3><p>{escape_html(answer)}</p></div>'
        )
    return f"""
<section aria-labelledby="faq-heading">
<h2 id="faq-heading">Frequently Asked Questions</h2>
{''.join(blocks)}
</section>
""".strip()


def build_link_summary_html(link_items, hub_title):
    count = len(link_items)
    if count == 0:
        return (
            f"<p>This hub is active, but it doesn't have related Verixia pages linked yet. "
            f"As more pages are generated in the {escape_html(hub_title)} category, they'll be linked here automatically.</p>"
        )
    return (
        f"<p>This hub currently links to {count} related Verixia pages so you can explore "
        f"specific tokens, workflows, and use cases inside the {escape_html(hub_title)} category.</p>"
    )


def tokenize_for_analysis(text):
    return re.findall(r"[a-z0-9]+", normalize_keyword(text))


def natural_list(items, max_items=4):
    cleaned = [compact_spaces(str(x)) for x in items if compact_spaces(str(x))]
    cleaned = cleaned[:max_items]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"


def get_hub_keyword_insights(matched_keywords, hub_terms):
    channel_counter = Counter()
    intent_counter  = Counter()
    entity_counter  = Counter()

    hub_term_tokens = set()
    for term in iter_match_terms(hub_terms):
        hub_term_tokens |= normalize_term_tokens(term)

    for keyword in matched_keywords:
        tokens = tokenize_for_analysis(keyword)
        for token in tokens:
            if token in CHANNEL_HINTS:
                channel_counter[CHANNEL_HINTS[token]] += 1
            if token in INTENT_HINTS:
                intent_counter[INTENT_HINTS[token]] += 1
            if (
                token not in GENERIC_ENTITY_WORDS
                and token not in hub_term_tokens
                and len(token) > 2
                and not token.isdigit()
            ):
                entity_counter[token] += 1

    return {
        "top_entities": [title_case(x) for x, _ in entity_counter.most_common(8)],
        "top_channels": [x for x, _ in channel_counter.most_common(6)],
        "top_intents":  [x for x, _ in intent_counter.most_common(6)],
    }


def detect_hub_context(hub_slug, hub_terms):
    combined = f"{hub_slug} {' '.join(iter_match_terms(hub_terms))}".lower()
    if any(x in combined for x in ["meme", "memecoin", "wonderland", "hoppy", "fartcoin", "pepe", "wif", "bonk"]):
        return "memes"
    if any(x in combined for x in ["signal", "trending", "discovery", "fresh launch", "top gainers"]):
        return "signals"
    if any(x in combined for x in ["brand", "tokenized", "stocks", "aaplx", "tslax", "nvdax", "spyx", "qqqx"]):
        return "brands"
    if any(x in combined for x in ["bridge", "cross chain", "cross-chain", "wormhole", "debridge", "allbridge"]):
        return "bridges"
    if any(x in combined for x in ["swap", "buy", "spl token", "aggregator", "jupiter"]):
        return "swap"
    if any(x in combined for x in ["whale", "smart money", "insider", "deployer", "sniper"]):
        return "whale"
    if any(x in combined for x in ["launch", "launchpad", "bonding curve", "deploy"]):
        return "launch"
    if any(x in combined for x in ["wallet", "self custodial", "non custodial", "phantom", "backpack"]):
        return "wallet"
    if "how to" in combined:
        return "guide"
    return "general"


def build_dynamic_keyword_summary_html(matched_keywords, hub_terms):
    if not matched_keywords:
        fallback = (
            "This hub is active based on the cluster mapping for this category. "
            "As generated pages accumulate here, this section will reflect the most common tokens, wallet types, and workflows people are searching for."
        )
        return f"""
<section aria-labelledby="keyword-patterns-heading">
<h2 id="keyword-patterns-heading">What People Are Searching For</h2>
<p>{escape_html(fallback)}</p>
</section>
""".strip()

    insights = get_hub_keyword_insights(matched_keywords, hub_terms)
    entities = natural_list(insights["top_entities"], 5)
    channels = natural_list([title_case(x) for x in insights["top_channels"]], 4)
    intents  = natural_list(insights["top_intents"], 4)

    paragraphs = []
    if entities:
        paragraphs.append(
            f"Across the related pages in this hub, people frequently search about {escape_html(entities)}. "
            f"That suggests this category often overlaps with specific tokens, brands, or workflows users want to access from a Solana wallet."
        )
    if channels:
        paragraphs.append(
            f"The keyword patterns also show that these workflows often run through {escape_html(channels)}. "
            f"That matters because the access channel usually shapes the user experience, the wallet flow, and the tokens available."
        )
    if intents:
        paragraphs.append(
            f"Another strong pattern across the matched searches is {escape_html(intents)}. "
            f"That kind of intent is common among users moving away from centralized exchanges toward self-custodial, mobile-first Solana DeFi."
        )

    if not paragraphs:
        paragraphs.append(
            "The matched searches in this hub show repeated intent around self-custodial trading, mobile-first access, and skipping centralized exchange friction."
        )

    body = "\n".join(f"<p>{paragraph}</p>" for paragraph in paragraphs)
    return f"""
<section aria-labelledby="keyword-patterns-heading">
<h2 id="keyword-patterns-heading">What People Are Searching For</h2>
{body}
</section>
""".strip()


def build_dynamic_entity_focus_html(matched_keywords, hub_terms):
    if not matched_keywords:
        return ""
    insights = get_hub_keyword_insights(matched_keywords, hub_terms)
    entities = insights["top_entities"][:8]
    if not entities:
        return ""
    items_html = "\n".join(f"<li>{escape_html(item)}</li>" for item in entities)
    return f"""
<section aria-labelledby="entity-focus-heading">
<h2 id="entity-focus-heading">Common Tokens, Brands & Platforms</h2>
<p>These are the tokens, brands, and recognizable names that show up most often in related search patterns across this hub.</p>
<ul>
{items_html}
</ul>
</section>
""".strip()


def build_cluster_specific_intro_html(intro, matched_keywords, hub_terms):
    if not matched_keywords:
        return f"""
<section aria-labelledby="hub-intro-heading">
<h2 id="hub-intro-heading" style="position:absolute;left:-9999px;">Hub Introduction</h2>
<p>{escape_html(intro)}</p>
<p>This hub is being maintained from the cluster definitions, even if the related pages aren't all present yet.</p>
</section>
""".strip()

    insights      = get_hub_keyword_insights(matched_keywords, hub_terms)
    top_channels  = natural_list([title_case(x) for x in insights["top_channels"]], 3)
    top_intents   = natural_list(insights["top_intents"], 3)

    supporting = []
    if top_channels:
        supporting.append(f"In this category, activity often shows up through {escape_html(top_channels)}.")
    if top_intents:
        supporting.append(f"Repeated search patterns also suggest that {escape_html(top_intents)} shows up often in these variations.")

    supporting_html = "\n".join(f"<p>{sentence}</p>" for sentence in supporting)
    return f"""
<section aria-labelledby="hub-intro-heading">
<h2 id="hub-intro-heading" style="position:absolute;left:-9999px;">Hub Introduction</h2>
<p>{escape_html(intro)}</p>
{supporting_html}
</section>
""".strip()


def build_meta_keyword_support_text(matched_keywords, hub_terms):
    if not matched_keywords:
        return "self-custodial Solana DeFi, no-KYC swaps, and wallet-based DEX workflows"
    insights = get_hub_keyword_insights(matched_keywords, hub_terms)
    parts = []
    if insights["top_entities"]:
        parts.append(f"tokens like {natural_list(insights['top_entities'], 4)}")
    if insights["top_channels"]:
        parts.append(f"channels like {natural_list([title_case(x) for x in insights['top_channels']], 4)}")
    if insights["top_intents"]:
        parts.append(f"intents like {natural_list(insights['top_intents'], 4)}")
    if not parts:
        return "self-custodial Solana DeFi and wallet-based DEX workflows"
    return "; ".join(parts)


def dedupe_preserve_order(items):
    seen = set()
    output = []
    for item in items:
        key = compact_spaces(str(item).lower())
        if key and key not in seen:
            seen.add(key)
            output.append(item)
    return output


def build_common_scenarios_html(hub_slug, matched_keywords, hub_terms):
    context     = detect_hub_context(hub_slug, hub_terms)
    base_points = list(COMMON_SCENARIO_TEMPLATES.get(context, COMMON_SCENARIO_TEMPLATES["general"]))
    examples    = HUB_SCENARIO_EXAMPLES.get(hub_slug, [])
    combined    = dedupe_preserve_order(base_points + examples)
    if not combined:
        return ""
    items_html = "\n".join(
        f"<li>{escape_html(item)}</li>"
        for item in combined[:MAX_COMMON_SCENARIOS]
    )
    return f"""
<section aria-labelledby="common-scenarios-heading">
<h2 id="common-scenarios-heading">Common Use Cases</h2>
<p>These are recurring scenarios and use cases that show up across the related pages in this hub.</p>
<ul>
{items_html}
</ul>
</section>
""".strip()


def build_comparison_html(hub_slug):
    pairs = HUB_COMPARISON_POINTS.get(hub_slug, GENERIC_COMPARISON_POINTS)
    if not pairs:
        return ""
    blocks = []
    for verixia_side, cex_side in pairs[:MAX_COMPARISON_POINTS]:
        blocks.append(
            f"""
<div class="comparison-item">
  <div class="comparison-col nexus">
    <h3>Verixia</h3>
    <p>{escape_html(verixia_side)}</p>
  </div>
  <div class="comparison-col cex">
    <h3>Centralized Exchange</h3>
    <p>{escape_html(cex_side)}</p>
  </div>
</div>
""".strip()
        )
    return f"""
<section aria-labelledby="comparison-heading">
<h2 id="comparison-heading">Verixia vs Centralized Exchanges</h2>
<p>The structural differences between self-custodial wallet trading and centralized exchange trading shape how each workflow feels in practice.</p>
{''.join(blocks)}
</section>
""".strip()


def build_schema(hub_slug, hub_title, description, intro, link_items, matched_keywords, hub_terms):
    canonical = build_canonical(hub_slug)
    faq_entities = [
        {
            "@type": "Question",
            "name": question,
            "acceptedAnswer": {"@type": "Answer", "text": answer},
        }
        for question, answer in get_faqs_for_hub(hub_slug)
    ]
    keyword_support = build_meta_keyword_support_text(matched_keywords, hub_terms)
    schema_objects = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": hub_title,
            "description": description,
            "url": canonical,
            "about": intro,
            "keywords": keyword_support,
            "mainEntity": {
                "@type": "ItemList",
                "name": f"{hub_title} Related Pages",
                "numberOfItems": len(link_items),
            },
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                # Position 1: parent brand home (intentional cross-origin
                # reference back to verixiaapps.com).
                {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE},
                # Position 2: the swap dApp root, same origin as this page.
                {"@type": "ListItem", "position": 2, "name": "Verixia Swap", "item": f"{SWAP_SITE}/"},
                {"@type": "ListItem", "position": 3, "name": hub_title, "item": canonical},
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": f"{hub_title} Related Pages",
            "itemListOrder": "https://schema.org/ItemListOrderAscending",
            "numberOfItems": len(link_items),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": index + 1,
                    # item['href'] is now "/<slug>/", so the absolute URL
                    # lands on swap.verixiaapps.com.
                    "url": f"{SWAP_SITE}{item['href']}",
                    "name": item["anchor"],
                }
                for index, item in enumerate(link_items)
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faq_entities,
        },
    ]
    return json.dumps(schema_objects, ensure_ascii=False, separators=(",", ":"))


def validate_hub_output(hub_slug, hub_title, description, canonical, matched_keywords, link_items, html):
    errors = []
    if not hub_slug:
        errors.append("empty hub slug")
    if not hub_title.strip():
        errors.append("empty title")
    if len(description) < 110 or len(description) > 165:
        errors.append("description length out of target range")
    if not canonical.endswith(f"/{hub_slug}/"):
        errors.append("canonical mismatch")
    if html.count("<h2") < 8:
        errors.append("insufficient section depth")
    if len(html) < 8000:
        errors.append("page html too thin")
    if "<main" not in html:
        errors.append("missing main landmark")
    if "application/ld+json" not in html:
        errors.append("missing schema")
    if "og:title" not in html or "twitter:title" not in html:
        errors.append("missing social metadata")
    if not link_items:
        errors.append("no linked child pages")
    if matched_keywords and len(link_items) == 0:
        errors.append("matched keywords exist but no child pages were found on disk")
    return errors


# =============================================================================
# HTML TEMPLATE
# =============================================================================

def build_hub_html(hub_slug, hub_title, description, intro, link_items,
                    top_topics_html, key_features_html, related_topics_html,
                    faq_html, matched_keywords, hub_terms):
    canonical    = build_canonical(hub_slug)
    links_html   = build_related_links_html(link_items)
    schema_json  = build_schema(hub_slug, hub_title, description, intro, link_items, matched_keywords, hub_terms)
    how_it_works = build_how_it_works_html(hub_slug)
    who_targeted = build_who_targeted_html(hub_slug)
    get_started  = build_get_started_html(hub_slug)
    link_summary = build_link_summary_html(link_items, hub_title)
    kw_summary   = build_dynamic_keyword_summary_html(matched_keywords, hub_terms)
    entity_focus = build_dynamic_entity_focus_html(matched_keywords, hub_terms)
    intro_html   = build_cluster_specific_intro_html(intro, matched_keywords, hub_terms)
    scenarios    = build_common_scenarios_html(hub_slug, matched_keywords, hub_terms)
    comparison   = build_comparison_html(hub_slug)

    jump_links = []
    sections   = []

    if top_topics_html:
        jump_links.append('<a href="#variations-heading">Topics</a>')
        sections.append(f'<div class="section-card">{top_topics_html}</div>')

    if scenarios:
        jump_links.append('<a href="#common-scenarios-heading">Use Cases</a>')
        sections.append(f'<div class="section-card">{scenarios}</div>')

    jump_links.append('<a href="#keyword-patterns-heading">What People Search</a>')
    sections.append(f'<div class="section-card">{kw_summary}</div>')

    if comparison:
        jump_links.append('<a href="#comparison-heading">vs CEX</a>')
        sections.append(f'<div class="section-card">{comparison}</div>')

    jump_links.append('<a href="#how-it-works-heading">How It Works</a>')
    sections.append(f'<div class="section-card">{how_it_works}</div>')

    jump_links.append('<a href="#targeting-heading">Who It Is For</a>')
    sections.append(f'<div class="section-card">{who_targeted}</div>')

    if entity_focus:
        jump_links.append('<a href="#entity-focus-heading">Tokens & Brands</a>')
        sections.append(f'<div class="section-card">{entity_focus}</div>')

    if related_topics_html:
        jump_links.append('<a href="#related-topics-heading">Related Topics</a>')
        sections.append(f'<div class="section-card">{related_topics_html}</div>')

    jump_links.append('<a href="#key-features-heading">Key Features</a>')
    sections.append(f"""
<section class="section-card warning-surface" aria-labelledby="key-features-heading">
<h2 id="key-features-heading">Key Features</h2>
<p>These are the features that define this category on Verixia.</p>
<ul>
{key_features_html}
</ul>
</section>
""".strip())

    jump_links.append('<a href="#get-started-heading">Get Started</a>')
    sections.append(f'<div class="section-card verify-surface">{get_started}</div>')

    jump_links.append('<a href="#related-checks-heading">Related Pages</a>')
    sections.append(f"""
<section class="section-card link-surface" aria-labelledby="related-checks-heading">
<h2 id="related-checks-heading">Related Pages</h2>
{link_summary}
<div class="link-box">
{"<ul>" + links_html + "</ul>" if link_items else "<p>No linked pages are available yet for this hub.</p>"}
</div>
</section>
""".strip())

    sections.append("""
<section class="section-card closing-surface" aria-labelledby="what-to-do-heading">
<h2 id="what-to-do-heading">What To Do Next</h2>
<p>If this category matches what you're trying to do, the fastest path is to connect a Solana wallet and try a small first trade. Every workflow on Verixia is wallet-based, so there's no signup to complete before testing.</p>
<p>If you're still researching, use the related pages above to compare specific tokens, brands, or workflows. Each page covers a focused use case inside this category.</p>
</section>
""".strip())

    jump_links.append('<a href="#faq-heading">FAQ</a>')
    sections.append(f'<div class="section-card faq-surface">{faq_html}</div>')

    sections_html   = "\n\n<div class=\"section-divider\"></div>\n\n".join(sections)
    jump_links_html = "\n  ".join(jump_links)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape_html(hub_title)}</title>
<meta name="description" content="{escape_html(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="{escape_html(canonical)}">
<meta property="og:title" content="{escape_html(hub_title)}">
<meta property="og:description" content="{escape_html(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{escape_html(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape_html(hub_title)}">
<meta name="twitter:description" content="{escape_html(description)}">
<script type="application/ld+json">{schema_json}</script>
<style>
:root{{
--bg:#07111f;--bg-2:#0c1728;--bg-3:#12203a;
--surface:rgba(255,255,255,.06);--surface-2:rgba(255,255,255,.08);--surface-3:rgba(255,255,255,.04);
--card:#101c33;--card-2:#162541;
--ink:#e8f0ff;--ink-strong:#ffffff;--ink-dark:#132033;
--muted:#9eb0cf;--muted-2:#7e93b5;
--line:rgba(148,163,184,.20);--line-2:rgba(255,255,255,.10);
--cyan:#22d3ee;--cyan-2:#06b6d4;--blue:#3b82f6;--blue-2:#2563eb;
--violet:#8b5cf6;--violet-2:#7c3aed;
--emerald:#10b981;--emerald-2:#059669;
--amber:#f59e0b;--red:#ef4444;
--green-soft:rgba(16,185,129,.12);--green-line:rgba(16,185,129,.26);
--red-soft:rgba(239,68,68,.10);--red-line:rgba(239,68,68,.22);
--shadow-xl:0 32px 90px rgba(2,6,23,.42);--shadow-lg:0 20px 54px rgba(2,6,23,.30);
--shadow-md:0 12px 30px rgba(2,6,23,.22);--shadow-sm:0 8px 20px rgba(2,6,23,.16);
}}
*{{box-sizing:border-box;}}
html{{-webkit-text-size-adjust:100%;scroll-behavior:smooth;}}
body{{
font-family:Inter,system-ui,-apple-system,Arial,sans-serif;margin:0;padding-top:90px;
color:var(--ink);line-height:1.7;
background:
radial-gradient(circle at 14% 8%, rgba(34,211,238,.16), transparent 22%),
radial-gradient(circle at 84% 0%, rgba(139,92,246,.20), transparent 28%),
radial-gradient(circle at 50% 100%, rgba(16,185,129,.08), transparent 24%),
linear-gradient(180deg,#06101b 0%, #0a1324 34%, #0e1830 100%);
}}
a{{color:#8be9ff;text-decoration:none;}}
a:hover{{text-decoration:underline;}}
@supports (padding:max(0px)){{body{{padding-left:max(0px, env(safe-area-inset-left));padding-right:max(0px, env(safe-area-inset-right));}}}}
.top-bar{{position:fixed;top:0;left:0;width:100%;display:flex;justify-content:space-between;align-items:center;padding:10px 16px;z-index:1000;pointer-events:none;}}
.top-actions{{pointer-events:auto;display:flex;align-items:center;gap:10px;margin-right:20px;}}
.logo{{pointer-events:auto;display:inline-flex;align-items:center;gap:10px;font-size:14px;font-weight:900;color:#eef6ff;margin-left:8px;padding:11px 15px;border-radius:999px;letter-spacing:-.01em;background:rgba(10,18,35,.68);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(14px);box-shadow:var(--shadow-sm);text-decoration:none;}}
.logo:hover{{text-decoration:none;}}
.logo-dot{{width:10px;height:10px;border-radius:50%;background:linear-gradient(180deg,var(--cyan) 0%,var(--violet) 100%);box-shadow:0 0 0 4px rgba(139,92,246,.14);flex:0 0 10px;}}
.app-top{{display:inline-flex;align-items:center;justify-content:center;padding:11px 14px;font-size:14px;border-radius:16px;font-weight:900;color:#fff;border:1px solid rgba(255,255,255,.12);white-space:nowrap;background:linear-gradient(180deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.08) 100%);backdrop-filter:blur(10px);box-shadow:var(--shadow-sm);}}
.app-top:hover{{text-decoration:none;}}
.checker-top{{pointer-events:auto;padding:11px 15px;font-size:14px;border-radius:16px;font-weight:900;background:linear-gradient(135deg,var(--violet) 0%,var(--cyan-2) 100%);color:#fff;white-space:nowrap;box-shadow:0 16px 34px rgba(34,211,238,.16);}}
.checker-top:hover{{text-decoration:none;}}
.page-shell{{max-width:980px;margin:0 auto;padding:0 14px 40px;}}
.hero{{position:relative;padding:18px 8px 22px;max-width:980px;margin:0 auto 14px;text-align:center;}}
.hero-badge-row{{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-bottom:14px;}}
.hero-badge{{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 13px;border-radius:999px;font-size:13px;font-weight:900;color:#dbeafe;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(10px);}}
.hero h1{{margin:0;font-size:48px;line-height:1.02;letter-spacing:-.05em;font-weight:950;color:var(--ink-strong);text-wrap:balance;}}
.hero p{{margin:14px auto 0;max-width:780px;font-size:19px;color:#c7d5eb;text-wrap:balance;}}
.hero-trust{{margin-top:18px;display:flex;flex-wrap:wrap;justify-content:center;gap:10px;}}
.hero-trust-chip{{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;font-size:13px;font-weight:900;color:#dce8fb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);box-shadow:var(--shadow-sm);}}
.content-section{{max-width:860px;margin:auto;padding:22px;border-radius:30px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.10);background:linear-gradient(180deg, rgba(17,28,51,.94) 0%, rgba(11,19,36,.98) 100%);box-shadow:var(--shadow-xl);}}
.content-section::before{{content:"";position:absolute;top:-120px;right:-90px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle, rgba(34,211,238,.14), transparent 65%);pointer-events:none;}}
.content-section > *{{position:relative;z-index:1;}}
.breadcrumbs{{margin:0 0 16px;font-size:13px;font-weight:900;color:#98adcf;line-height:1.6;}}
.breadcrumbs a{{color:#9fdcf4;font-weight:900;}}
.info-box,.hero-panel,.tool-cta-card,.section-card,.meta-strip{{background:linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);border:1px solid rgba(255,255,255,.10);border-radius:24px;box-shadow:var(--shadow-md);}}
.hero-panel{{padding:22px;margin:0 0 18px;background:linear-gradient(135deg, rgba(34,211,238,.12) 0%, rgba(139,92,246,.12) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.05) 100%);}}
.hero-panel-kicker{{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#8be9ff;margin-bottom:8px;}}
.hero-panel h2{{margin:0 0 8px;font-size:30px;line-height:1.08;letter-spacing:-.03em;color:#fff;}}
.hero-panel p{{margin:10px 0 0;font-size:15px;font-weight:800;color:#d8e5f8;line-height:1.75;}}
.info-box{{margin:0 0 20px;padding:18px;font-size:15px;color:#d6e3f7;font-weight:800;line-height:1.7;}}
h1,h2,h3{{margin:0 0 14px;color:#fff;line-height:1.08;letter-spacing:-.035em;font-weight:900;text-wrap:balance;}}
h1{{font-size:42px;}} h2{{font-size:30px;margin-top:0;}} h3{{font-size:22px;margin-top:0;}}
p, li{{font-size:17px;color:#d7e4f8;}}
p{{margin:0 0 16px;}}
ul,ol{{margin:0;padding-left:22px;}}
li{{margin-bottom:10px;}}
li::marker{{color:#8be9ff;}}
.jump-links{{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;}}
.jump-links a{{display:inline-flex;align-items:center;justify-content:center;padding:10px 13px;border-radius:999px;font-size:13px;font-weight:900;color:#dbeafe;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);box-shadow:var(--shadow-sm);}}
.jump-links a:hover{{text-decoration:none;transform:translateY(-1px);}}
.tool-cta-card{{margin:0 0 24px;padding:24px;text-align:center;background:linear-gradient(135deg, rgba(34,211,238,.10) 0%, rgba(139,92,246,.10) 100%),linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.04) 100%);}}
.tool-cta-card h3{{margin:0 0 8px;font-size:28px;}}
.tool-cta-card p{{margin:0 auto 14px;max-width:620px;font-size:15px;line-height:1.7;color:#c8d6ec;font-weight:700;}}
.tool-cta-button{{display:block;width:100%;text-decoration:none;text-align:center;background:linear-gradient(135deg,var(--violet) 0%,var(--cyan-2) 100%);color:#fff;font-weight:900;padding:16px;border-radius:18px;box-shadow:0 18px 40px rgba(34,211,238,.20);font-size:17px;letter-spacing:.2px;}}
.tool-cta-button:hover{{text-decoration:none;transform:translateY(-1px);box-shadow:0 22px 44px rgba(34,211,238,.24);}}
.tool-cta-note{{margin-top:12px;font-size:13px;color:#9fb0cc;font-weight:900;}}
.section-card{{padding:20px;}}
.section-card p:last-child,.section-card ul:last-child,.section-card ol:last-child{{margin-bottom:0;}}
.warning-surface{{background:linear-gradient(135deg, rgba(34,211,238,.10) 0%, rgba(139,92,246,.08) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);}}
.verify-surface{{background:linear-gradient(135deg, rgba(16,185,129,.10) 0%, rgba(34,211,238,.08) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);}}
.link-surface{{background:linear-gradient(135deg, rgba(59,130,246,.10) 0%, rgba(139,92,246,.10) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);}}
.closing-surface{{background:linear-gradient(135deg, rgba(16,185,129,.08) 0%, rgba(139,92,246,.08) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);}}
.faq-surface{{background:linear-gradient(135deg, rgba(139,92,246,.10) 0%, rgba(34,211,238,.08) 100%),linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.04) 100%);}}
.link-box{{margin-top:16px;padding:18px;border-radius:20px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);}}
.link-box ul{{padding-left:20px;}}
.link-box li{{margin-bottom:12px;}}
.link-box a{{color:#8be9ff;font-weight:900;}}
.meta-strip{{margin:22px 0 0;padding:16px 18px;font-size:14px;font-weight:900;color:#d8e5f8;line-height:1.7;}}
.section-divider{{height:1px;background:linear-gradient(90deg, transparent, rgba(139,92,246,.45), rgba(34,211,238,.45), transparent);margin:28px 0;}}
.faq-item + .faq-item{{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.10);}}
.faq-item h3{{font-size:20px;margin-bottom:8px;}}
.comparison-item{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;}}
.comparison-col{{padding:16px;border-radius:18px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);}}
.comparison-col.nexus{{background:var(--green-soft);border-color:var(--green-line);}}
.comparison-col.cex{{background:var(--red-soft);border-color:var(--red-line);}}
.comparison-col h3{{font-size:18px;margin-bottom:8px;}}
.comparison-col p:last-child{{margin-bottom:0;}}
@media (max-width:640px){{
body{{padding-top:84px;}}
.top-bar{{padding:10px 10px;}}
.top-actions{{gap:8px;margin-right:0;}}
.logo{{font-size:13px;margin-left:2px;padding:9px 12px;}}
.app-top{{font-size:13px;padding:8px 10px;}}
.checker-top{{font-size:13px;padding:8px 10px;margin-right:0;}}
.page-shell{{padding:0 12px 34px;}}
.hero{{padding:14px 6px 18px;}}
.hero h1{{font-size:34px;}}
.hero p{{margin-top:10px;font-size:17px;}}
.content-section{{padding:18px;border-radius:24px;}}
.hero-panel h2{{font-size:24px;}}
h1{{font-size:32px;}} h2{{font-size:24px;}} h3{{font-size:20px;}}
p,li{{font-size:16px;}}
.jump-links{{gap:8px;}}
.jump-links a{{font-size:13px;padding:9px 11px;}}
.comparison-item{{grid-template-columns:1fr;}}
}}
</style>
</head>
<body>

<div class="top-bar">
  <a class="logo" href="{SWAP_SITE}/">
    <span class="logo-dot"></span>
    <span>Verixia</span>
  </a>
  <div class="top-actions">
    <a class="app-top" href="https://apps.apple.com/app/id6759490910" target="_blank" rel="noopener noreferrer">Get App</a>
    <a class="checker-top" href="{SWAP_SITE}/">Open Verixia</a>
  </div>
</div>

<div class="page-shell">

  <div class="hero">
    <div class="hero-badge-row">
      <div class="hero-badge">Self-custodial</div>
      <div class="hero-badge">No KYC</div>
      <div class="hero-badge">Mobile-first</div>
    </div>

    <h1>{escape_html(hub_title)}</h1>
    <p>Explore features, compare workflows, and learn how this category works from a self-custodial Solana wallet.</p>

    <div class="hero-trust">
      <div class="hero-trust-chip">Wallet-based</div>
      <div class="hero-trust-chip">No signup</div>
      <div class="hero-trust-chip">On-chain settlement</div>
    </div>
  </div>

  <main class="content-section">
    <div class="breadcrumbs">
      <a href="{SITE}/">Home</a> / <a href="{SWAP_SITE}/">Verixia</a> / <span>{escape_html(hub_title)}</span>
    </div>

    <div class="hero-panel">
      <div class="hero-panel-kicker">Category hub</div>
      <h2>Compare workflows faster</h2>
      <p>This hub groups together related Verixia pages so you can review features, compare workflows, and quickly navigate to the most relevant pages in this category.</p>
    </div>

    <div class="info-box">
      Every workflow on Verixia is self-custodial and wallet-based. Funds stay in your wallet between trades, there's no signup or KYC, and every position settles on-chain. The platform never holds your funds.
    </div>

    {intro_html}
    <p>Use the related pages below to explore specific tokens, brands, and workflows inside this category.</p>

    <nav class="jump-links" aria-label="Page sections">
      {jump_links_html}
    </nav>

    <div class="tool-cta-card">
      <h3>Ready to try it?</h3>
      <p>Connect a Solana wallet and start trading from your phone. No signup, no KYC, no centralized account, and one transaction signature per trade.</p>
      <a class="tool-cta-button" href="{SWAP_SITE}/">Open Verixia</a>
      <div class="tool-cta-note">Self-custodial | No signup | Works on mobile</div>
    </div>

    {sections_html}

    <div class="meta-strip">
      Explore Verixia features, compare workflows, and use the linked pages above to investigate specific tokens and use cases inside this category.
    </div>
  </main>
</div>
</body>
</html>
"""


def save_hub(slug, html):
    folder = os.path.join(OUTPUT_DIR, slug)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "index.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)


def save_report(report):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    keywords = load_keywords()

    validation_warning_count = 0
    built_count = 0
    validation_details = []

    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Canonical base: {SWAP_SITE}")

    for hub_slug, raw_match_terms in CLUSTERS.items():
        match_terms = iter_match_terms(raw_match_terms)
        matched = [kw for kw in keywords if matches_cluster(kw, match_terms)] if keywords else []
        matched = dedupe_cluster_keywords(matched)
        matched = sorted(matched, key=lambda k: score_keyword(k, match_terms))[:MAX_LINKS_PER_HUB]
        link_items = build_related_link_items(matched)

        hub_title   = HUB_TITLES.get(hub_slug, title_case(hub_slug.replace("-", " ")))
        intro       = HUB_INTROS.get(hub_slug, INTRO_FALLBACK)
        description = trim_meta_description(HUB_META_DESCRIPTIONS.get(hub_slug, META_FALLBACK))
        canonical   = build_canonical(hub_slug)

        top_topics_html     = build_top_topics_html(matched, match_terms)
        key_features_html   = build_key_features_html(hub_slug)
        related_topics_html = build_related_topics_html(match_terms)
        faq_html            = build_faq_html(hub_slug)

        html = build_hub_html(
            hub_slug=hub_slug,
            hub_title=hub_title,
            description=description,
            intro=intro,
            link_items=link_items,
            top_topics_html=top_topics_html,
            key_features_html=key_features_html,
            related_topics_html=related_topics_html,
            faq_html=faq_html,
            matched_keywords=matched,
            hub_terms=match_terms,
        )

        validation_errors = validate_hub_output(
            hub_slug=hub_slug,
            hub_title=hub_title,
            description=description,
            canonical=canonical,
            matched_keywords=matched,
            link_items=link_items,
            html=html,
        )

        if validation_errors:
            validation_warning_count += 1
            validation_details.append({
                "hub_slug":         hub_slug,
                "matched_keywords": len(matched),
                "linked_pages":     len(link_items),
                "errors":           validation_errors,
            })
            print(f"Validation warning for {hub_slug}: {'; '.join(validation_errors)}")

        save_hub(hub_slug, html)
        built_count += 1
        print(f"Built hub: {hub_slug} (matched keywords: {len(matched)}, linked pages: {len(link_items)})")

    report = {
        "keywords_loaded":     len(keywords),
        "hubs_built":          built_count,
        "validation_warnings": validation_warning_count,
        "validation_details":  validation_details,
    }
    save_report(report)

    print("\n--- HUB BUILD REPORT ---")
    print(f"Keywords loaded: {len(keywords)}")
    print(f"Hubs built: {built_count}")
    print(f"Validation warnings: {validation_warning_count}")
    print(f"Saved report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
