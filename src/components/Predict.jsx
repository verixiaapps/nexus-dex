// Predict.jsx
// Polymarket Predict tab for NexusDEX
// Drop into src/components/Predict.jsx
//
// ============================================================================
// SETUP CHECKLIST (one-time, ~10 min total)
// ============================================================================
// 1. Register for Polymarket builder code: https://polymarket.com/settings?tab=builder
//    - Set rate to 1% (you already decided)
//    - Get your builder API key + passphrase
//    - Drop into .env as POLYMARKET_BUILDER_KEY and POLYMARKET_BUILDER_SECRET
//
// 2. Install required packages:
//    npm install @polymarket/clob-client ethers@5.7.2
//
// 3. Your OKX cross-chain credentials are reused from your existing swap setup.
//    No new env vars needed.
//
// 4. Done. Order placement goes live on first user trade.
// ============================================================================
//
// ARCHITECTURE
// ----------------------------------------------------------------------------
// - Browse markets: Polymarket Gamma API (public, no auth, no backend)
// - Bridge USDC: OKX cross-chain swap API (your existing auth)
// - Place orders: Polymarket CLOB client (client-side, 1 sig per order)
// - Builder fee 1%: stamped via builder code on every order
// - All state in component, no backend, no database
// ============================================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

// ============================================================================
// CONFIG
// ============================================================================
const TREASURY_SOL = 'Dd6bKf6SXYQfs24M8evyTXo1MdYrZgbxhk6wWby8NRFV';
const POLYGON_CHAIN_ID = 137;
const SOLANA_CHAIN_ID = 501;

// Token addresses
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const SOL_NATIVE = '11111111111111111111111111111111';

// Polymarket APIs
const POLYMARKET_GAMMA = 'https://gamma-api.polymarket.com';
const POLYMARKET_CLOB = 'https://clob.polymarket.com';

// Your fees (locked in)
const BUILDER_FEE_BPS = 100; // 1% Polymarket builder fee
const OKX_BRIDGE_FEE_PCT = '1'; // 1% bridge fee to your treasury

// OKX cross-chain endpoint (uses your existing auth utility)
const OKX_CROSS_CHAIN_QUOTE = 'https://web3.okx.com/api/v6/dex/cross-chain/quote';
const OKX_CROSS_CHAIN_BUILD = 'https://web3.okx.com/api/v6/dex/cross-chain/build-tx';

// localStorage keys
const LS_POLYGON_ADDRESS = 'predict_polygon_addr';
const LS_USDC_BALANCE_CACHE = 'predict_usdc_balance';

// ============================================================================
// LEGAL & GEO RESTRICTIONS
// ============================================================================
const TOS_VERSION = 1;
const LS_TOS_ACCEPTED = `predict_tos_v${TOS_VERSION}_accepted`;

const hasAcceptedTOS = () => {
  try {
    const raw = localStorage.getItem(LS_TOS_ACCEPTED);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data?.accepted === true;
  } catch { return false; }
};

const saveTOSAcceptance = () => {
  try {
    localStorage.setItem(LS_TOS_ACCEPTED, JSON.stringify({
      accepted: true,
      timestamp: Date.now(),
      version: TOS_VERSION,
    }));
  } catch {}
};

// ============================================================================
// HELPERS
// ============================================================================
const formatVol = (n) => n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${(n || 0).toFixed(0)}`;
const formatPrice = (p) => `${Math.round(p * 100)}¢`;
const formatTimeRemaining = (endDate) => {
  if (!endDate) return '';
  const ms = new Date(endDate).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
};
const iconFor = (market) => {
  const q = (market.question || '').toLowerCase();
  if (q.includes('btc') || q.includes('bitcoin')) return '₿';
  if (q.includes('eth') || q.includes('ethereum')) return 'Ξ';
  if (q.includes('sol')) return '◎';
  if (q.includes('trump') || q.includes('election')) return '🇺🇸';
  if (q.includes('fed') || q.includes('s&p') || q.includes('rate')) return '📊';
  if (q.includes('sport') || q.includes('nfl') || q.includes('nba')) return '🏀';
  return '🎯';
};

// ============================================================================
// POLYMARKET — fetch markets (public API, no auth)
// ============================================================================
async function fetchPolymarketMarkets({ category = 'crypto', limit = 20 } = {}) {
  try {
    const url = `${POLYMARKET_GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}${category ? `&tag_id=${category}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Polymarket fetch failed');
    const data = await res.json();
    return (data || []).map(normalizeMarket).filter(Boolean);
  } catch (err) {
    console.error('[Predict] Market fetch failed:', err);
    return [];
  }
}

function normalizeMarket(m) {
  try {
    const outcomes = JSON.parse(m.outcomes || '["Yes","No"]');
    const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
    return {
      id: m.id || m.conditionId,
      slug: m.slug,
      question: m.question,
      yesPrice: parseFloat(prices[0]) || 0.5,
      noPrice: parseFloat(prices[1]) || 0.5,
      volume24h: parseFloat(m.volume24hr) || 0,
      endDate: m.endDate,
      conditionId: m.conditionId,
      tokenIds: JSON.parse(m.clobTokenIds || '[]'),
      icon: iconFor(m),
      minOrderSize: parseFloat(m.minimumOrderSize) || 1,
      tickSize: parseFloat(m.tickSize) || 0.01,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// OKX CROSS-CHAIN BRIDGE
// ============================================================================
// Note: Uses your existing OKX auth utility. Adjust the import path to match
// your project. Expected signature:
//   getOkxHeaders(timestamp, method, requestPath, queryString)
import { getOkxHeaders } from '../utils/okxAuth'; // ← adjust this path to your existing OKX auth file

async function getBridgeQuote({ amountUsdc, userSolAddress, userPolygonAddress }) {
  const params = {
    fromChainId: String(SOLANA_CHAIN_ID),
    toChainId: String(POLYGON_CHAIN_ID),
    fromTokenAddress: USDC_SOLANA,
    toTokenAddress: USDC_POLYGON,
    amount: String(Math.floor(amountUsdc * 1e6)), // USDC has 6 decimals
    userWalletAddress: userSolAddress,
    receiveAddress: userPolygonAddress,
    slippage: '0.5',
    // Your 1% bridge fee to treasury
    feePercent: OKX_BRIDGE_FEE_PCT,
    fromTokenReferrerWalletAddress: TREASURY_SOL,
  };

  const ts = new Date().toISOString();
  const queryString = '?' + new URLSearchParams(params).toString();
  const headers = getOkxHeaders(ts, 'GET', '/api/v6/dex/cross-chain/quote', queryString);
  const res = await fetch(OKX_CROSS_CHAIN_QUOTE + queryString, { headers });
  const data = await res.json();
  if (data.code !== '0') throw new Error(data.msg || 'OKX quote failed');
  return data.data[0];
}

async function buildBridgeTx({ amountUsdc, userSolAddress, userPolygonAddress }) {
  const params = {
    fromChainId: String(SOLANA_CHAIN_ID),
    toChainId: String(POLYGON_CHAIN_ID),
    fromTokenAddress: USDC_SOLANA,
    toTokenAddress: USDC_POLYGON,
    amount: String(Math.floor(amountUsdc * 1e6)),
    userWalletAddress: userSolAddress,
    receiveAddress: userPolygonAddress,
    slippage: '0.5',
    feePercent: OKX_BRIDGE_FEE_PCT,
    fromTokenReferrerWalletAddress: TREASURY_SOL,
  };

  const ts = new Date().toISOString();
  const queryString = '?' + new URLSearchParams(params).toString();
  const headers = getOkxHeaders(ts, 'GET', '/api/v6/dex/cross-chain/build-tx', queryString);
  const res = await fetch(OKX_CROSS_CHAIN_BUILD + queryString, { headers });
  const data = await res.json();
  if (data.code !== '0') throw new Error(data.msg || 'OKX build-tx failed');
  return data.data[0];
}

// ============================================================================
// POLYMARKET ORDER PLACEMENT
// ============================================================================
// Polygon side. User signs an EIP-712 order with builder code stamped.
// Polymarket's relayer executes for free (no gas to user).
//
// Requires: npm install @polymarket/clob-client ethers@5.7.2
// User's EVM signer comes from Phantom or Backpack (both support multi-chain).
async function placePolymarketOrder({ market, side, amountUsdc, evmSigner }) {
  // Dynamic import so the bundle doesn't break if package not installed yet
  const { ClobClient, Side, OrderType } = await import('@polymarket/clob-client');

  const builderApiKey = process.env.REACT_APP_POLYMARKET_BUILDER_KEY;
  const builderSecret = process.env.REACT_APP_POLYMARKET_BUILDER_SECRET;
  if (!builderApiKey || !builderSecret) {
    throw new Error('Polymarket builder credentials not configured. Register at polymarket.com/settings');
  }

  const client = new ClobClient(POLYMARKET_CLOB, POLYGON_CHAIN_ID, evmSigner, {
    key: builderApiKey,
    secret: builderSecret,
    passphrase: process.env.REACT_APP_POLYMARKET_BUILDER_PASSPHRASE || '',
  });

  // YES = tokenIds[0], NO = tokenIds[1]
  const tokenId = side === 'YES' ? market.tokenIds[0] : market.tokenIds[1];
  const price = side === 'YES' ? market.yesPrice : market.noPrice;

  const order = await client.createMarketOrder({
    tokenID: tokenId,
    amount: amountUsdc,
    side: Side.BUY,
    feeRateBps: BUILDER_FEE_BPS, // Your 1% builder fee
  });

  const resp = await client.postOrder(order, OrderType.FOK); // Fill-or-Kill market order
  return resp;
}

// ============================================================================
// POLYGON ADDRESS DERIVATION
// ============================================================================
// User connects an EVM wallet (Phantom EVM, Backpack, etc) for Polygon.
// Polymarket auto-creates a Gnosis Safe proxy for them on first trade.
async function getOrPromptPolygonAddress() {
  // Try cache first
  const cached = localStorage.getItem(LS_POLYGON_ADDRESS);
  if (cached) return cached;

  // Prompt connection to EVM wallet
  if (!window.ethereum) {
    throw new Error('No EVM wallet detected. Install Phantom or Backpack.');
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accounts || !accounts.length) throw new Error('No EVM account');

  const addr = accounts[0];
  localStorage.setItem(LS_POLYGON_ADDRESS, addr);
  return addr;
}

async function getPolygonUsdcBalance(address) {
  if (!address) return 0;
  try {
    // ERC20 balanceOf call via public Polygon RPC
    const data = '0x70a08231' + address.slice(2).padStart(64, '0');
    const res = await fetch('https://polygon-rpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: USDC_POLYGON, data }, 'latest'],
      }),
    });
    const json = await res.json();
    const hex = json.result;
    return parseInt(hex, 16) / 1e6; // USDC has 6 decimals
  } catch (err) {
    console.error('[Predict] Balance fetch failed:', err);
    return 0;
  }
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
const Tag = ({ children, variant = 'default' }) => {
  const variants = {
    default: 'bg-zinc-800/60 text-zinc-300 border-zinc-700',
    cyan: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40',
    emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
    red: 'bg-red-500/10 text-red-300 border-red-500/40',
  };
  return <span className={`text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded border ${variants[variant]}`}>{children}</span>;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Predict() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [activeTab, setActiveTab] = useState('crypto');
  const [markets, setMarkets] = useState([]);
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [polygonAddress, setPolygonAddress] = useState(null);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [showSetupFlow, setShowSetupFlow] = useState(false);
  const [showTOS, setShowTOS] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const hasSetup = !!polygonAddress && usdcBalance > 0;

  // Load markets on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [crypto, trend] = await Promise.all([
        fetchPolymarketMarkets({ category: 'crypto', limit: 20 }),
        fetchPolymarketMarkets({ category: '', limit: 10 }), // top across all
      ]);
      if (!cancelled) {
        setMarkets(crypto);
        setTrending(trend);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Check setup status on wallet connect
  useEffect(() => {
    if (!connected) return;
    const cached = localStorage.getItem(LS_POLYGON_ADDRESS);
    if (cached) {
      setPolygonAddress(cached);
      getPolygonUsdcBalance(cached).then(setUsdcBalance);
    }
  }, [connected]);

  const activeData = activeTab === 'crypto' ? markets : trending;

  const handleMarketTap = (market) => {
    if (!connected) {
      alert('Connect your Solana wallet first');
      return;
    }
    if (!hasAcceptedTOS()) {
      setPendingAction({ type: 'buy', market });
      setShowTOS(true);
      return;
    }
    if (!hasSetup) {
      setShowSetupFlow(true);
    } else {
      setSelectedMarket(market);
    }
  };

  const handleSetupClick = () => {
    if (!hasAcceptedTOS()) {
      setPendingAction({ type: 'setup' });
      setShowTOS(true);
      return;
    }
    setShowSetupFlow(true);
  };

  const handleTOSAccept = () => {
    saveTOSAcceptance();
    setShowTOS(false);
    if (pendingAction?.type === 'setup') {
      setShowSetupFlow(true);
    } else if (pendingAction?.type === 'buy') {
      if (!hasSetup) setShowSetupFlow(true);
      else setSelectedMarket(pendingAction.market);
    }
    setPendingAction(null);
  };

  const handleSetupComplete = async (newAddress, newBalance) => {
    setPolygonAddress(newAddress);
    setUsdcBalance(newBalance);
    setShowSetupFlow(false);
  };

  const handleTradeComplete = (cost) => {
    setUsdcBalance((b) => Math.max(0, b - cost));
    setSelectedMarket(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-white pb-32">
      {/* HERO */}
      <div className="px-4 pt-6 pb-2">
        <div className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-cyan-950/30 p-6 backdrop-blur">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/5 px-3 py-1 mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-cyan-300">POWERED BY POLYMARKET</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight leading-none mb-2">
            Predict <em className="not-italic bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent italic">anything</em>
            <br />
            on <em className="not-italic bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent italic">chain</em>
          </h1>
          <p className="text-sm text-zinc-400 mb-2 leading-snug">Trade real-money predictions on crypto, markets, and world events.</p>
          <p className="text-[10px] text-zinc-500 mb-6 tracking-wider">NON-CUSTODIAL · TRADES SETTLE ON POLYMARKET · SELF-CUSTODY VIA YOUR WALLET</p>
          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
            <div className="text-center">
              <div className="text-xl font-black tracking-tight">$25.7B</div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-500 mt-1">VOLUME</div>
            </div>
            <div className="text-center border-x border-zinc-800/80">
              <div className="text-xl font-black tracking-tight">5,400+</div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-500 mt-1">MARKETS</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-black tracking-tight text-emerald-400">1.29M</div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-zinc-500 mt-1">TRADERS</div>
            </div>
          </div>
        </div>
      </div>

      {/* SETUP CARD or BALANCE */}
      {!hasSetup ? (
        <div className="px-4 mt-6">
          <button onClick={handleSetupClick} className="w-full rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/40 via-blue-950/40 to-zinc-900/60 p-5 text-left active:scale-[0.99] transition">
            <div className="flex items-start gap-3 mb-3">
              <div className="text-3xl">⚡</div>
              <div className="flex-1">
                <div className="text-[10px] font-bold tracking-[0.2em] text-cyan-300 mb-1">FIRST TIME?</div>
                <div className="text-lg font-black leading-tight">Set up Predict in 30 seconds</div>
              </div>
            </div>
            <div className="text-xs text-zinc-400 mb-3">Bridge USDC from Solana to start trading. 2 quick signatures, then you're done forever.</div>
            <div className="flex items-center justify-between pt-3 border-t border-cyan-500/20">
              <span className="text-xs text-zinc-500">No gas on trades · Powered by OKX</span>
              <span className="text-xs font-bold tracking-wider text-cyan-300">START →</span>
            </div>
          </button>
        </div>
      ) : (
        <div className="px-4 mt-6">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] tracking-wider text-emerald-400 font-bold">PREDICT READY</div>
              <div className="text-lg font-black">${usdcBalance.toFixed(2)} USDC</div>
            </div>
            <button onClick={handleSetupClick} className="text-xs font-bold tracking-wider px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-300">
              + ADD FUNDS
            </button>
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="px-4 mt-6 mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            { id: 'crypto', label: 'Crypto', sub: 'Top traded' },
            { id: 'trending', label: 'Trending', sub: 'All categories' },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold tracking-wide border transition ${activeTab === tab.id ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/60' : 'bg-zinc-900/40 text-zinc-400 border-zinc-800/60'}`}>
              <div>{tab.label}</div>
              <div className="text-[9px] text-zinc-500 tracking-widest font-normal mt-0.5">{tab.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* MARKET LIST */}
      <div className="px-4 space-y-2">
        {loading && (
          <div className="text-center py-12 text-zinc-500">
            <div className="inline-block animate-spin h-8 w-8 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 mb-3" />
            <div className="text-xs tracking-wider font-bold">LOADING MARKETS</div>
          </div>
        )}
        {!loading && activeData.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-xs">No markets right now. Try again in a minute.</div>
        )}
        {!loading && activeData.map((market) => (
          <button key={market.id} onClick={() => handleMarketTap(market)} className="w-full text-left rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 active:scale-[0.99] transition">
            <div className="flex items-start gap-3 mb-3">
              <div className="text-2xl shrink-0">{market.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm leading-snug mb-1">{market.question}</div>
                <div className="flex items-center gap-2 text-[10px] tracking-wider text-zinc-500 font-bold">
                  <span>VOL {formatVol(market.volume24h)}</span>
                  <span className="text-zinc-700">·</span>
                  <span>ENDS {formatTimeRemaining(market.endDate)}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2 text-center">
                <div className="text-[9px] tracking-widest text-emerald-400 font-bold">YES</div>
                <div className="text-lg font-black text-emerald-300">{formatPrice(market.yesPrice)}</div>
              </div>
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-center">
                <div className="text-[9px] tracking-widest text-red-400 font-bold">NO</div>
                <div className="text-lg font-black text-red-300">{formatPrice(market.noPrice)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* MODALS */}
      {showTOS && (
        <DisclaimerModal
          onAccept={handleTOSAccept}
          onClose={() => { setShowTOS(false); setPendingAction(null); }}
        />
      )}
      {showSetupFlow && (
        <SetupModal
          onClose={() => setShowSetupFlow(false)}
          onComplete={handleSetupComplete}
          solWallet={publicKey?.toBase58()}
          solConnection={connection}
          signTransaction={signTransaction}
        />
      )}
      {selectedMarket && (
        <BuyModal
          market={selectedMarket}
          balance={usdcBalance}
          polygonAddress={polygonAddress}
          onClose={() => setSelectedMarket(null)}
          onTrade={handleTradeComplete}
        />
      )}
    </div>
  );
}

// ============================================================================
// SETUP MODAL — first-time bridge flow (and add funds)
// ============================================================================
function SetupModal({ onClose, onComplete, solWallet, solConnection, signTransaction }) {
  const [amount, setAmount] = useState(25);
  const [step, setStep] = useState('select'); // select | connecting | quoting | bridging | success | error
  const [polygonAddr, setPolygonAddr] = useState(null);
  const [quote, setQuote] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const presets = [25, 50, 100, 250];

  // Step 1: ensure we have a Polygon address
  useEffect(() => {
    (async () => {
      try {
        setStep('connecting');
        const addr = await getOrPromptPolygonAddress();
        setPolygonAddr(addr);
        setStep('select');
      } catch (e) {
        setErrorMsg(e.message);
        setStep('error');
      }
    })();
  }, []);

  // Fetch quote when amount changes
  useEffect(() => {
    if (step !== 'select' || !solWallet || !polygonAddr) return;
    let cancelled = false;
    (async () => {
      try {
        const q = await getBridgeQuote({
          amountUsdc: amount,
          userSolAddress: solWallet,
          userPolygonAddress: polygonAddr,
        });
        if (!cancelled) setQuote(q);
      } catch (e) {
        console.warn('[Predict] Quote failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [amount, step, solWallet, polygonAddr]);

  const handleBridge = async () => {
    setStep('bridging');
    setErrorMsg('');
    try {
      // 1. Build bridge tx
      const txData = await buildBridgeTx({
        amountUsdc: amount,
        userSolAddress: solWallet,
        userPolygonAddress: polygonAddr,
      });

      // 2. Deserialize, sign, and send Solana transaction
      const txBuffer = Buffer.from(txData.tx.data, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      const signed = await signTransaction(tx);
      const sig = await solConnection.sendRawTransaction(signed.serialize());
      await solConnection.confirmTransaction(sig, 'confirmed');

      // 3. Wait for funds to land on Polygon (~30s typical)
      let landed = false;
      let polygonBalance = 0;
      for (let i = 0; i < 24; i++) { // poll up to 2 min
        await new Promise(r => setTimeout(r, 5000));
        polygonBalance = await getPolygonUsdcBalance(polygonAddr);
        if (polygonBalance >= amount * 0.9) { landed = true; break; }
      }

      if (!landed) throw new Error('Bridge taking longer than expected. Check polygonscan.com for your address.');

      setStep('success');
      setTimeout(() => onComplete(polygonAddr, polygonBalance), 1200);
    } catch (e) {
      console.error('[Predict] Bridge failed:', e);
      setErrorMsg(e?.message || 'Bridge failed. Try again.');
      setStep('error');
    }
  };

  const bridgeFeePctOfAmount = quote ? (1 - parseFloat(quote.toTokenAmount) / 1e6 / amount) * 100 : null;
  const youReceive = quote ? parseFloat(quote.toTokenAmount) / 1e6 : amount * 0.97;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="text-[10px] font-bold tracking-[0.2em] text-cyan-300">SET UP PREDICT</div>
          <button onClick={onClose} className="text-zinc-500 text-xl leading-none">×</button>
        </div>

        {step === 'connecting' && (
          <div className="py-8 text-center">
            <div className="inline-block animate-spin h-12 w-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 mb-4" />
            <div className="text-sm font-bold mb-1">Connecting Polygon wallet...</div>
            <div className="text-xs text-zinc-500">Approve in your wallet (Phantom/Backpack)</div>
          </div>
        )}

        {step === 'select' && (
          <>
            <div className="text-sm text-zinc-300 mb-4">Bridge USDC from Solana to fund your Predict account.</div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {presets.map((p) => (
                <button key={p} onClick={() => setAmount(p)}
                  className={`rounded-xl border p-3 text-center transition ${amount === p ? 'border-cyan-500 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-900/40'}`}>
                  <div className="text-base font-black">${p}</div>
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4 text-xs space-y-2">
              <div className="flex justify-between"><span className="text-zinc-400">You bridge</span><span className="text-zinc-200 font-bold">${amount.toFixed(2)} USDC</span></div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Bridge cost</span>
                <span className="text-zinc-300">{quote ? `~$${(amount - youReceive).toFixed(2)} (${bridgeFeePctOfAmount?.toFixed(1)}%)` : 'getting quote...'}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-zinc-800">
                <span className="text-zinc-300 font-bold">You receive on Polygon</span>
                <span className="text-emerald-400 font-bold">${youReceive.toFixed(2)}</span>
              </div>
            </div>

            <div className="text-[10px] text-zinc-500 mb-4 text-center tracking-wider">2 SIGNATURES · NO GAS ON TRADES</div>

            <button onClick={handleBridge} disabled={!quote}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 text-zinc-950 font-black tracking-wide active:scale-[0.99] transition disabled:opacity-50">
              BRIDGE ${amount} VIA OKX
            </button>

            <div className="text-center text-[9px] text-zinc-600 mt-4 tracking-wider px-2">
              Non-custodial. Funds bridge via OKX directly to your Polygon wallet. NexusDEX never holds, accesses, or controls your funds.
            </div>
          </>
        )}

        {step === 'bridging' && (
          <div className="py-8 text-center">
            <div className="inline-block animate-spin h-12 w-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 mb-4" />
            <div className="text-sm font-bold mb-1">Bridging via OKX...</div>
            <div className="text-xs text-zinc-500">Solana → Polygon · ~30 seconds</div>
          </div>
        )}

        {step === 'success' && (
          <div className="py-8 text-center">
            <div className="text-5xl mb-3">✓</div>
            <div className="text-sm font-bold text-emerald-400 mb-1">Predict ready</div>
            <div className="text-xs text-zinc-500">Tap any market to start trading</div>
          </div>
        )}

        {step === 'error' && (
          <div className="py-8 text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <div className="text-sm font-bold text-red-400 mb-2">Setup failed</div>
            <div className="text-xs text-zinc-500 mb-4 px-2">{errorMsg}</div>
            <button onClick={() => { setStep('select'); setErrorMsg(''); }}
              className="text-xs font-bold tracking-wide px-4 py-2 rounded-full border border-zinc-700 text-zinc-300">
              TRY AGAIN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// BUY MODAL — place order via Polymarket CLOB (1 sig)
// ============================================================================
function BuyModal({ market, balance, polygonAddress, onClose, onTrade }) {
  const [side, setSide] = useState('YES');
  const [amount, setAmount] = useState(5);
  const [step, setStep] = useState('select'); // select | signing | placing | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const presets = [1, 5, 10, 25];

  const price = side === 'YES' ? market.yesPrice : market.noPrice;
  const shares = amount / Math.max(price, 0.01);
  const potentialPayout = shares;
  const profit = potentialPayout - amount;

  const handleBuy = async () => {
    setErrorMsg('');
    setStep('signing');
    try {
      // Get EVM signer from the user's multi-chain wallet (Phantom, Backpack)
      const { ethers } = await import('ethers');
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const evmSigner = provider.getSigner();

      setStep('placing');
      const result = await placePolymarketOrder({
        market,
        side,
        amountUsdc: amount,
        evmSigner,
      });

      if (!result || result.errorMsg) {
        throw new Error(result?.errorMsg || 'Order failed');
      }

      setStep('success');
      setTimeout(() => onTrade(amount), 1200);
    } catch (e) {
      console.error('[Predict] Order failed:', e);
      setErrorMsg(e?.message || 'Order failed. Try again.');
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-bold tracking-[0.2em] text-cyan-300">PLACE ORDER</div>
          <button onClick={onClose} className="text-zinc-500 text-xl leading-none">×</button>
        </div>

        <div className="flex items-start gap-3 mb-5">
          <div className="text-2xl">{market.icon}</div>
          <div className="flex-1">
            <div className="font-bold text-sm leading-snug">{market.question}</div>
            <div className="text-[10px] tracking-wider text-zinc-500 font-bold mt-1">VOL {formatVol(market.volume24h)} · BAL ${balance.toFixed(2)}</div>
          </div>
        </div>

        {step === 'select' && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setSide('YES')}
                className={`rounded-xl border p-3 transition ${side === 'YES' ? 'border-emerald-500 bg-emerald-500/15' : 'border-zinc-800 bg-zinc-900/40'}`}>
                <div className="text-[9px] tracking-widest text-emerald-400 font-bold">YES</div>
                <div className="text-2xl font-black text-emerald-300">{formatPrice(market.yesPrice)}</div>
              </button>
              <button onClick={() => setSide('NO')}
                className={`rounded-xl border p-3 transition ${side === 'NO' ? 'border-red-500 bg-red-500/15' : 'border-zinc-800 bg-zinc-900/40'}`}>
                <div className="text-[9px] tracking-widest text-red-400 font-bold">NO</div>
                <div className="text-2xl font-black text-red-300">{formatPrice(market.noPrice)}</div>
              </button>
            </div>

            <div className="text-[10px] tracking-widest text-zinc-500 font-bold mb-2">AMOUNT</div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {presets.map((p) => (
                <button key={p} onClick={() => setAmount(p)}
                  className={`rounded-lg border py-2 text-sm font-bold transition ${amount === p ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400'}`}>
                  ${p}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4 text-xs space-y-2">
              <div className="flex justify-between"><span className="text-zinc-400">Shares</span><span className="text-zinc-200 font-bold">{shares.toFixed(2)} {side}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Avg price</span><span className="text-zinc-300">{formatPrice(price)}</span></div>
              <div className="flex justify-between pt-2 border-t border-zinc-800"><span className="text-zinc-300 font-bold">If wins</span><span className="text-emerald-400 font-bold">${potentialPayout.toFixed(2)} (+${profit.toFixed(2)})</span></div>
            </div>

            <div className="text-[10px] text-zinc-500 mb-3 text-center tracking-wider">1 SIGNATURE · NO GAS</div>

            <button onClick={handleBuy} disabled={amount > balance}
              className={`w-full py-4 rounded-2xl font-black tracking-wide active:scale-[0.99] transition disabled:opacity-50 ${side === 'YES' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-zinc-950' : 'bg-gradient-to-r from-red-400 to-red-500 text-zinc-950'}`}>
              {amount > balance ? 'INSUFFICIENT BALANCE' : `BUY ${side} · $${amount}`}
            </button>

            <div className="text-center text-[9px] text-zinc-600 mt-4 tracking-wider px-2">
              Order placed directly on Polymarket. Settlement and custody on-chain via your wallet.
            </div>
          </>
        )}

        {step === 'signing' && (
          <div className="py-8 text-center">
            <div className="inline-block animate-spin h-12 w-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 mb-4" />
            <div className="text-sm font-bold mb-1">Approve in wallet...</div>
            <div className="text-xs text-zinc-500">Sign the order (no gas)</div>
          </div>
        )}

        {step === 'placing' && (
          <div className="py-8 text-center">
            <div className="inline-block animate-spin h-12 w-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 mb-4" />
            <div className="text-sm font-bold mb-1">Placing on Polymarket...</div>
            <div className="text-xs text-zinc-500">~1 second</div>
          </div>
        )}

        {step === 'success' && (
          <div className="py-8 text-center">
            <div className="text-5xl mb-3">✓</div>
            <div className="text-sm font-bold text-emerald-400 mb-1">Order placed</div>
            <div className="text-xs text-zinc-500">{shares.toFixed(2)} {side} shares · ${amount}</div>
          </div>
        )}

        {step === 'error' && (
          <div className="py-8 text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <div className="text-sm font-bold text-red-400 mb-2">Order failed</div>
            <div className="text-xs text-zinc-500 mb-4 px-2">{errorMsg}</div>
            <button onClick={() => { setStep('select'); setErrorMsg(''); }}
              className="text-xs font-bold tracking-wide px-4 py-2 rounded-full border border-zinc-700 text-zinc-300">
              TRY AGAIN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DISCLAIMER MODAL — Terms, liability release, geo-restriction acknowledgment
// ============================================================================
function DisclaimerModal({ onAccept, onClose }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm max-h-[75vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col">

        <div className="px-5 pt-5 pb-3 border-b border-zinc-800 shrink-0">
          <div className="text-[10px] font-bold tracking-[0.2em] text-amber-400 mb-1">⚠️ REQUIRED</div>
          <div className="text-base font-black leading-tight">Predict Terms &amp; Liability Release</div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">

          <TosSection title="Non-custodial frontend">
            NexusDEX is NOT a broker, exchange, or custodian. Polymarket executes all trades. Funds bridge via OKX directly to your wallet. <strong className="text-zinc-200">NexusDEX never holds your funds.</strong>
          </TosSection>

          <TosSection title="Risk">
            <strong className="text-zinc-200">You may lose your entire position.</strong> Markets are volatile, can resolve in disputed ways, and third-party services (OKX, Polymarket, Polygon) can fail. No warranties of any kind.
          </TosSection>

          <TosSection title="Release of liability">
            You release NexusDEX, its operators, and affiliates from all liability for any loss, damage, or injury — including lost funds, failed bridges, smart contract failures, oracle disputes, price movements, regulatory actions, or third-party failures. <strong className="text-zinc-200">You covenant not to sue.</strong>
          </TosSection>

          <TosSection title="No class action">
            Disputes resolved by binding individual arbitration only. <strong className="text-zinc-200">You waive class action and jury trial rights.</strong>
          </TosSection>

          <TosSection title="Geo restrictions">
            You may NOT use Predict if located in: US, France, Belgium, Switzerland, Portugal, Hungary, Netherlands, UK, Germany, Italy, Argentina, Australia, Singapore, Romania, Ontario (Canada), Poland, Thailand, Taiwan, or any OFAC-sanctioned country (NK, Iran, Cuba, Syria, Russia, Belarus, etc.). <strong className="text-zinc-200">No VPN/proxy circumvention.</strong>
          </TosSection>

          <TosSection title="Not advice">
            Nothing here is financial, legal, or tax advice. You are solely responsible for your decisions and tax obligations.
          </TosSection>

          <TosSection title="Indemnification">
            You agree to indemnify NexusDEX from any third-party claims arising from your use or violation of these terms.
          </TosSection>

        </div>

        <div className="px-5 py-4 border-t border-zinc-800 space-y-3 shrink-0">
          <TosCheckbox checked={agreed} onChange={setAgreed}
            label="I agree to all terms above, confirm I am not in a restricted region, and release NexusDEX from all liability." />

          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose}
              className="py-2.5 rounded-xl border border-zinc-700 text-zinc-400 font-bold tracking-wider text-[11px]">
              DECLINE
            </button>
            <button onClick={onAccept} disabled={!agreed}
              className="py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-zinc-950 font-black tracking-wider text-[11px] disabled:opacity-30">
              ACCEPT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TosSection({ title, children }) {
  return (
    <div>
      <div className="text-xs font-bold text-cyan-300 mb-1">{title}</div>
      <div className="text-[11px] text-zinc-400 leading-relaxed">{children}</div>
    </div>
  );
}

function TosCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer leading-snug">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-cyan-500 shrink-0" />
      <span>{label}</span>
    </label>
  );
}
