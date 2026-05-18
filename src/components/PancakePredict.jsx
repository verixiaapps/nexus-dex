import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  createPublicClient, http, encodeFunctionData,
  parseEther, formatEther, isAddress, decodeErrorResult,
} from 'viem';
import { bsc } from 'viem/chains';

// =====================================================================
// CONFIG — PancakeSwap Prediction on BNB Chain. Isolated EVM wallet flow
// (window.ethereum) — does NOT touch the app's Solana wallet stack.
// =====================================================================
const ENABLE_TRADING   = process.env.REACT_APP_PANCAKE_LIVE_TRADING === '1';
const TREASURY_BSC     = process.env.REACT_APP_PANCAKE_TREASURY_BSC || '';
const ENTRY_FEE_BPS    = Number(process.env.REACT_APP_PANCAKE_FEE_BPS || 150);     // 1.5%
const WIN_FEE_BPS      = Number(process.env.REACT_APP_PANCAKE_WIN_FEE_BPS || 1000); // 10%
const BSC_RPC_URL      = process.env.REACT_APP_BSC_RPC_URL || 'https://bsc-dataseed.binance.org';

const BSC_CHAIN_ID     = 56;
const BSC_CHAIN_ID_HEX = '0x38';

const MIN_BET_BNB      = 0.001;   // matches PancakeSwap's on-chain minBetAmount (~$0.60). Bump once live tests pass.
const MAX_BET_BNB      = 100;
const STALE_STATE_MS   = 30_000;  // disable betting if round data hasn't refreshed in this long
const BET_CUTOFF_SECS  = 30;
const ROUND_REFRESH_MS = 5_000;
const BETS_REFRESH_MS  = 15_000;

// Verify on bscscan.com/address/... before going live with real funds.
// V2 contract has the highest volume; V3 is newer with different fee handling.
const PREDICTION_CONTRACTS = {
  BNB: '0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA',
  BTC: process.env.REACT_APP_PANCAKE_BTC_CONTRACT || '',
  ETH: process.env.REACT_APP_PANCAKE_ETH_CONTRACT || '',
};

const ASSETS = [
  { id: 'BNB', label: 'BNB/USD', enabled: true },
  { id: 'BTC', label: 'BTC/USD', enabled: Boolean(PREDICTION_CONTRACTS.BTC) },
  { id: 'ETH', label: 'ETH/USD', enabled: Boolean(PREDICTION_CONTRACTS.ETH) },
];

// =====================================================================
// MINIMAL ABI — only what we call
// =====================================================================
const PREDICTION_ABI = [
  { name: 'currentEpoch',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'intervalSeconds', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'minBetAmount',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'paused',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'rounds', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }], outputs: [
      { name: 'epoch',          type: 'uint256' },
      { name: 'startTimestamp', type: 'uint256' },
      { name: 'lockTimestamp',  type: 'uint256' },
      { name: 'closeTimestamp', type: 'uint256' },
      { name: 'lockPrice',      type: 'int256'  },
      { name: 'closePrice',     type: 'int256'  },
      { name: 'lockOracleId',   type: 'uint256' },
      { name: 'closeOracleId',  type: 'uint256' },
      { name: 'totalAmount',    type: 'uint256' },
      { name: 'bullAmount',     type: 'uint256' },
      { name: 'bearAmount',     type: 'uint256' },
      { name: 'rewardBaseCalAmount', type: 'uint256' },
      { name: 'rewardAmount',   type: 'uint256' },
      { name: 'oracleCalled',   type: 'bool' },
    ] },
  { name: 'ledger', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [
      { name: 'position', type: 'uint8'  },
      { name: 'amount',   type: 'uint256' },
      { name: 'claimed',  type: 'bool' },
    ] },
  { name: 'claimable',  type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'refundable', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'getUserRounds', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
    outputs: [
      { type: 'uint256[]' },
      { type: 'tuple[]', components: [
        { name: 'position', type: 'uint8'  },
        { name: 'amount',   type: 'uint256' },
        { name: 'claimed',  type: 'bool' },
      ]},
      { type: 'uint256' },
    ] },
  { name: 'betBull', type: 'function', stateMutability: 'payable',  inputs: [{ type: 'uint256' }], outputs: [] },
  { name: 'betBear', type: 'function', stateMutability: 'payable',  inputs: [{ type: 'uint256' }], outputs: [] },
  { name: 'claim',   type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256[]' }], outputs: [] },
];

// =====================================================================
// DESIGN TOKENS — match Nexus DEX palette from App.js
// =====================================================================
const C = {
  bg:'#03060f', card:'#080d1a',
  ink:'#cdd6f4', inkStr:'#fff',
  muted:'#586994', muted2:'#3e4c6b',
  accent:'#00e5ff', accent2:'#0066ff',
  green:'#00ffa3', red:'#ff3b6b', amber:'#ffb84d',
  // PancakeSwap brand cameo only
  pcsYellow:'#f0b90b', pcsPink:'#1fc7d4',
  border:'rgba(0,229,255,.10)', borderHi:'rgba(0,229,255,.30)',
  hairline:'rgba(255,255,255,.04)',
  glow:'0 0 24px rgba(0,229,255,.12),0 0 48px rgba(0,229,255,.04)',
};
const T = {
  display: { fontFamily: "'Syne', sans-serif" },
  body:    { fontFamily: "'Syne', sans-serif" },
  mono:    { fontFamily: "'IBM Plex Mono', 'SF Mono', monospace" },
};

// =====================================================================
// UTILS
// =====================================================================
function fmtBnb(v, decimals = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(decimals).replace(/\.?0+$/, '');
}
function fmtUsd(rawPrice) {
  const n = Number(rawPrice) / 1e8;  // Chainlink price feeds = 8 decimals
  if (!Number.isFinite(n) || n === 0) return '-';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return '$' + n.toFixed(2);
}
function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }
function cleanAmount(v) {
  const s = String(v || '').replace(/[^0-9.]/g, '');
  const p = s.split('.');
  return p.length <= 2 ? s : p[0] + '.' + p.slice(1).join('');
}
function formatCountdown(ms) {
  if (ms <= 0) return 'CLOSED';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 1) return `${m}:${sec.toString().padStart(2, '0')}`;
  return `${sec}s`;
}
// Pool-based payout multiplier. Pancake protocol fee = 3% off the pool.
// (totalPool × 0.97) / sideAmount = payout per BNB bet on that side.
function computeMultiplier(totalAmount, sideAmount) {
  const total = Number(totalAmount);
  const side  = Number(sideAmount);
  if (side <= 0 || total <= 0) return 0;
  return (total * 0.97) / side;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

let _bodyLockCount = 0;
function useBodyLock(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    if (_bodyLockCount === 0) document.body.classList.add('nexus-scroll-locked');
    _bodyLockCount++;
    return () => {
      _bodyLockCount = Math.max(0, _bodyLockCount - 1);
      if (_bodyLockCount === 0) document.body.classList.remove('nexus-scroll-locked');
    };
  }, [open]);
}

// =====================================================================
// EVM CLIENT — viem read client + window.ethereum write helpers
// =====================================================================
const publicClient = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC_URL),
});

function getInjectedProvider() {
  if (typeof window === 'undefined') return null;
  return window.ethereum || null;
}

function detectWalletName() {
  const p = getInjectedProvider();
  if (!p) return null;
  if (p.isMetaMask)       return 'MetaMask';
  if (p.isRabby)          return 'Rabby';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isTrust)          return 'Trust Wallet';
  if (p.isOKExWallet)     return 'OKX Wallet';
  return 'Wallet';
}

async function evmRequestAccounts() {
  const p = getInjectedProvider();
  if (!p) throw new Error('No EVM wallet detected');
  return p.request({ method: 'eth_requestAccounts' });
}

async function evmCurrentChainId() {
  const p = getInjectedProvider();
  if (!p) return null;
  const hex = await p.request({ method: 'eth_chainId' });
  return parseInt(hex, 16);
}

async function evmSwitchToBsc() {
  const p = getInjectedProvider();
  if (!p) throw new Error('No EVM wallet detected');
  try {
    await p.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (err) {
    if (err?.code === 4902) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: BSC_CHAIN_ID_HEX,
          chainName: 'BNB Smart Chain',
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: ['https://bsc-dataseed.binance.org'],
          blockExplorerUrls: ['https://bscscan.com'],
        }],
      });
    } else throw err;
  }
}

// =====================================================================
// PRE-WALLET SIMULATION — mirrors the Stocks.jsx simulateBeforeSign flow,
// adapted for EVM. We dry-run the exact bet (betBull/betBear with the
// stake as msg.value) via eth_call BEFORE triggering the wallet. If sim
// reverts, surface a clean error in the UI and never open MetaMask.
// =====================================================================
const PANCAKE_REVERT_MESSAGES = {
  'Bet is too early/late':       'Round closed for betting',
  'Round not bettable':          'Round closed for betting',
  'Bet amount must be greater than minBetAmount':
                                 'Bet below minimum (try at least 0.001 BNB)',
  'Can only bet once per round': 'You already bet this round',
  'Pausable: paused':            'Market is paused — try again later',
  'Not eligible for claim':      'Nothing to claim for this round',
  'Not eligible for refund':     'Nothing to refund for this round',
  'Rewards calculated':          'Round still settling — try again shortly',
};

function parseEvmRevert(err) {
  // Wallet user rejection — not a contract revert
  if (err?.code === 4001) return 'Cancelled';

  // viem surfaces revert reasons via shortMessage / cause.reason / details
  const candidates = [
    err?.cause?.reason,
    err?.cause?.shortMessage,
    err?.reason,
    err?.shortMessage,
    err?.details,
    err?.message,
  ].filter(Boolean);

  for (const c of candidates) {
    // Direct match against known Pancake revert strings
    for (const [key, friendly] of Object.entries(PANCAKE_REVERT_MESSAGES)) {
      if (String(c).includes(key)) return friendly;
    }
  }

  const msg = String(err?.message || '');
  if (/insufficient funds/i.test(msg))   return 'Not enough BNB for bet + gas';
  if (/gas required exceeds/i.test(msg)) return 'Gas estimation failed';
  if (/nonce/i.test(msg))                return 'Wallet out of sync — refresh and retry';
  if (/timeout|network|fetch/i.test(msg))return 'Network error — try again';
  if (/reverted/i.test(msg)) {
    const clean = msg.replace(/^.*execution reverted:?\s*/i, '').slice(0, 140);
    return clean || 'Round may have just closed';
  }
  return 'Bet unavailable — try again';
}

async function simulateBet({ from, contractAddress, calldata, valueWei }) {
  try {
    await publicClient.call({
      account: from,
      to: contractAddress,
      data: calldata,
      value: valueWei,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: parseEvmRevert(e) };
  }
}

async function simulateClaim({ from, contractAddress, calldata }) {
  try {
    await publicClient.call({ account: from, to: contractAddress, data: calldata });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: parseEvmRevert(e) };
  }
}

// =====================================================================
// BUNDLED TX — EIP-5792 wallet_sendCalls (atomic) with sequential fallback.
// Same atomic-fee philosophy as Stocks.jsx: stake to contract + fee to
// treasury in one signature flow.
//
// For BETS: stake goes to Pancake contract (with betBull/betBear calldata),
// fee goes to treasury. Both succeed or both fail (when EIP-5792 supported).
//
// For CLAIMS: claim() pays winnings to msg.sender. Then a SECOND tx sends
// X% of winnings from user to treasury. Sequential is safer here — fee tx
// fires AFTER claim confirms and balance updates.
// =====================================================================
async function sendBundledTxs({ from, calls }) {
  const p = getInjectedProvider();
  if (!p) throw new Error('No EVM wallet detected');

  // Try EIP-5792 batched send first
  try {
    const result = await p.request({
      method: 'wallet_sendCalls',
      params: [{
        version: '1.0',
        chainId: BSC_CHAIN_ID_HEX,
        from,
        calls: calls.map(c => ({
          to:    c.to,
          value: '0x' + BigInt(c.valueWei || 0n).toString(16),
          data:  c.data || '0x',
        })),
      }],
    });
    return { type: 'batched', id: result?.id || result, hashes: [] };
  } catch (err) {
    const notSupported =
      err?.code === -32601 ||
      err?.code === -32602 ||
      /not supported|unknown method|unsupported|method not found/i.test(err?.message || '');
    if (!notSupported) throw err;
  }

  // Sequential fallback
  const hashes = [];
  for (const c of calls) {
    const hash = await p.request({
      method: 'eth_sendTransaction',
      params: [{
        from,
        to:    c.to,
        value: '0x' + BigInt(c.valueWei || 0n).toString(16),
        data:  c.data || '0x',
      }],
    });
    hashes.push(hash);
  }
  return { type: 'sequential', hashes };
}

// =====================================================================
// CONTRACT READS — round state + user bets
// =====================================================================
function parseRound(r) {
  if (!r) return null;
  return {
    epoch:          Number(r.epoch ?? r[0]),
    startTimestamp: Number(r.startTimestamp ?? r[1]) * 1000,
    lockTimestamp:  Number(r.lockTimestamp  ?? r[2]) * 1000,
    closeTimestamp: Number(r.closeTimestamp ?? r[3]) * 1000,
    lockPrice:      Number(r.lockPrice  ?? r[4]),
    closePrice:     Number(r.closePrice ?? r[5]),
    totalAmount:    Number(formatEther(r.totalAmount ?? r[8])),
    bullAmount:     Number(formatEther(r.bullAmount  ?? r[9])),
    bearAmount:     Number(formatEther(r.bearAmount  ?? r[10])),
    oracleCalled:   Boolean(r.oracleCalled ?? r[13]),
  };
}

async function fetchRoundState(asset) {
  const address = PREDICTION_CONTRACTS[asset];
  if (!address) return null;
  try {
    const [epoch, interval, minBet] = await Promise.all([
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'currentEpoch' }),
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'intervalSeconds' }),
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'minBetAmount' }).catch(() => 0n),
    ]);
    const currentEpoch = Number(epoch);
    const [liveRound, nextRound] = await Promise.all([
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'rounds', args: [BigInt(currentEpoch - 1)] }).catch(() => null),
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'rounds', args: [BigInt(currentEpoch)] }).catch(() => null),
    ]);
    return {
      asset, currentEpoch,
      intervalSeconds: Number(interval),
      minBetWei: minBet,
      live: parseRound(liveRound),
      next: parseRound(nextRound),
      fetchedAt: Date.now(),
    };
  } catch (e) {
    console.warn('[pancake fetchRoundState]', e?.message);
    return null;
  }
}

async function fetchRecentUserBets(asset, userAddress, count = 10) {
  const address = PREDICTION_CONTRACTS[asset];
  if (!address || !userAddress) return [];
  try {
    const result = await publicClient.readContract({
      address, abi: PREDICTION_ABI, functionName: 'getUserRounds',
      args: [userAddress, 0n, BigInt(count)],
    });
    const [epochs, ledgers] = result;
    const out = [];
    for (let i = 0; i < epochs.length; i++) {
      const epoch = Number(epochs[i]);
      const l = ledgers[i];
      const amount = Number(formatEther(l.amount ?? l[1]));
      if (amount <= 0) continue;
      const claimable = await publicClient.readContract({
        address, abi: PREDICTION_ABI, functionName: 'claimable',
        args: [BigInt(epoch), userAddress],
      }).catch(() => false);
      out.push({
        asset, epoch,
        position: Number(l.position ?? l[0]) === 0 ? 'UP' : 'DOWN',
        amount,
        claimed: Boolean(l.claimed ?? l[2]),
        claimable,
      });
    }
    return out;
  } catch (e) {
    console.warn('[fetchRecentUserBets]', e?.message);
    return [];
  }
}

// Compute expected payout for a winning bet — used to size the win-fee tx.
// Pancake formula: (totalPool × 0.97 × userBet) / winningSideTotal.
// We use this to estimate; actual payout from claim() is what's authoritative.
async function fetchExpectedPayout(asset, epoch, userAddress) {
  const address = PREDICTION_CONTRACTS[asset];
  if (!address || !userAddress) return 0n;
  try {
    const [roundData, ledger] = await Promise.all([
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'rounds', args: [BigInt(epoch)] }),
      publicClient.readContract({ address, abi: PREDICTION_ABI, functionName: 'ledger', args: [BigInt(epoch), userAddress] }),
    ]);
    const totalAmount = BigInt(roundData.totalAmount ?? roundData[8]);
    const bullAmount  = BigInt(roundData.bullAmount  ?? roundData[9]);
    const bearAmount  = BigInt(roundData.bearAmount  ?? roundData[10]);
    const lockPrice   = BigInt(roundData.lockPrice  ?? roundData[4]);
    const closePrice  = BigInt(roundData.closePrice ?? roundData[5]);
    const userPos     = Number(ledger.position ?? ledger[0]);  // 0 = Bull, 1 = Bear
    const userAmount  = BigInt(ledger.amount ?? ledger[1]);
    if (userAmount <= 0n) return 0n;
    const userWon = (userPos === 0 && closePrice > lockPrice) ||
                    (userPos === 1 && closePrice < lockPrice);
    if (!userWon) return 0n;
    const winningSide = userPos === 0 ? bullAmount : bearAmount;
    if (winningSide <= 0n) return 0n;
    // (totalAmount × 97 × userAmount) / (100 × winningSide)
    return (totalAmount * 97n * userAmount) / (100n * winningSide);
  } catch (e) {
    console.warn('[fetchExpectedPayout]', e?.message);
    return 0n;
  }
}

// =====================================================================
// (Mock state removed for live build — null state surfaces RPC issues
// to the user instead of showing fake prices/pools)
// =====================================================================

// =====================================================================
// SUB-COMPONENTS
// =====================================================================
function AssetIcon({ symbol, size = 38 }) {
  const palette = {
    BNB: ['#f0b90b', '#f5d060'],
    BTC: ['#f7931a', '#ffbf5c'],
    ETH: ['#627eea', '#8fa8ff'],
  }[symbol] || ['#00e5ff', '#0066ff'];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${palette[0]},${palette[1]})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(0,0,0,.78)', fontWeight: 900,
      fontSize: Math.round(size * 0.30), letterSpacing: '-.03em', flexShrink: 0,
      boxShadow: `0 4px 12px ${palette[0]}30`, ...T.display,
    }}>{symbol}</div>
  );
}

function CountdownText({ targetMs, urgent }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = targetMs - Date.now();
  const closed = remaining <= 0;
  const isUrgent = urgent && remaining > 0 && remaining < 60_000;
  return (
    <span style={{
      color: closed ? C.muted2 : isUrgent ? C.red : C.muted,
      fontWeight: isUrgent ? 800 : 600,
      ...T.mono,
    }}>{closed ? 'CLOSED' : formatCountdown(remaining)}</span>
  );
}

function LiveRoundCard({ state, onBet, account, onBsc, isStale }) {
  if (!state?.live) return null;
  const { live, next } = state;
  const livePool = live.totalAmount;
  const liveUp   = live.bullAmount;
  const upMult   = computeMultiplier(livePool, liveUp);
  const downMult = computeMultiplier(livePool, live.bearAmount);
  const upRatio  = livePool > 0 ? liveUp / livePool : 0.5;
  const nextOpen = Boolean(next);
  const nextMs   = next?.lockTimestamp || 0;
  const cutoffMs = nextMs - BET_CUTOFF_SECS * 1000;
  const canBet   = !isStale && nextOpen && Date.now() < cutoffMs;

  return (
    <div style={{
      marginBottom: 14, padding: 18, borderRadius: 16,
      background: C.card, border: `1px solid ${C.border}`,
      boxShadow: C.glow, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', right: -50, top: -60, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle,${C.pcsYellow}18,transparent 65%)`, pointerEvents: 'none' }}/>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <AssetIcon symbol={state.asset} size={44}/>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.inkStr, letterSpacing: '-.02em', ...T.display }}>{state.asset}/USD</div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', marginTop: 2, ...T.mono }}>LIVE #{live.epoch}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>POOL</div>
            <div style={{ fontSize: 14, color: C.inkStr, fontWeight: 800, marginTop: 2, ...T.mono }}>{fmtBnb(livePool, 2)} BNB</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>LOCKED</div>
            <div style={{ fontSize: 14, color: C.inkStr, fontWeight: 800, marginTop: 3, ...T.mono }}>{fmtUsd(live.lockPrice)}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(0,229,255,.05)', border: `1px solid ${C.borderHi}` }}>
            <div style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>RESOLVES</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, ...T.mono }}><CountdownText targetMs={live.closeTimestamp} urgent/></div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', background: 'rgba(255,255,255,.04)', marginBottom: 6 }}>
            <div style={{ width: `${upRatio * 100}%`, background: `linear-gradient(90deg,${C.green},${C.accent})`, transition: 'width .4s' }}/>
            <div style={{ flex: 1, background: `linear-gradient(90deg,${C.accent2},${C.red})` }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, ...T.mono }}>
            <span style={{ color: C.green, fontWeight: 700 }}>UP {(upRatio * 100).toFixed(0)}% · {upMult.toFixed(2)}x</span>
            <span style={{ color: C.red, fontWeight: 700 }}>{downMult.toFixed(2)}x · {((1 - upRatio) * 100).toFixed(0)}% DOWN</span>
          </div>
        </div>

        <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 8, ...T.mono }}>
          NEXT ROUND · BETS CLOSE <CountdownText targetMs={cutoffMs} urgent/>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            onClick={() => canBet && onBet(state.asset, 'UP', next.epoch)}
            disabled={!canBet}
            style={{
              padding: '14px 16px', borderRadius: 12,
              border: `1px solid ${canBet ? 'rgba(0,255,163,.4)' : C.border}`,
              background: canBet ? 'linear-gradient(135deg,rgba(0,255,163,.14),rgba(0,229,255,.06))' : 'rgba(255,255,255,.02)',
              color: canBet ? C.green : C.muted2,
              cursor: canBet ? 'pointer' : 'not-allowed',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              opacity: canBet ? 1 : 0.5, ...T.display,
            }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', ...T.mono }}>BET UP</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Closes higher</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>↑</div>
          </button>
          <button
            onClick={() => canBet && onBet(state.asset, 'DOWN', next.epoch)}
            disabled={!canBet}
            style={{
              padding: '14px 16px', borderRadius: 12,
              border: `1px solid ${canBet ? 'rgba(255,59,107,.4)' : C.border}`,
              background: canBet ? 'linear-gradient(135deg,rgba(255,59,107,.14),rgba(168,127,255,.06))' : 'rgba(255,255,255,.02)',
              color: canBet ? C.red : C.muted2,
              cursor: canBet ? 'pointer' : 'not-allowed',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              opacity: canBet ? 1 : 0.5, ...T.display,
            }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', ...T.mono }}>BET DOWN</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2, ...T.mono }}>Closes lower</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>↓</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionsPanel({ bets, onClaim, claiming }) {
  if (!bets || bets.length === 0) return null;
  const claimable = bets.filter(b => b.claimable && !b.claimed);
  const pending   = bets.filter(b => !b.claimable && !b.claimed);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>YOUR ROUNDS</div>
        {claimable.length > 0 && (
          <button
            onClick={() => onClaim(claimable)}
            disabled={claiming}
            style={{
              padding: '6px 12px', borderRadius: 99, border: 'none',
              background: `linear-gradient(135deg,${C.green},${C.accent})`,
              color: C.bg, fontWeight: 800, fontSize: 11,
              cursor: claiming ? 'wait' : 'pointer', ...T.display,
            }}>{claiming ? 'Claiming…' : `Claim ${claimable.length}`}</button>
        )}
      </div>
      {[...claimable, ...pending].map(b => (
        <div key={`${b.asset}-${b.epoch}`} style={{
          marginBottom: 6, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AssetIcon symbol={b.asset} size={28}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{
                fontSize: 9, fontWeight: 800,
                color: b.position === 'UP' ? C.green : C.red,
                padding: '1px 6px', borderRadius: 4,
                background: b.position === 'UP' ? 'rgba(0,255,163,.12)' : 'rgba(255,59,107,.12)',
                ...T.mono,
              }}>{b.position}</span>
              <span style={{ fontSize: 10, color: C.muted2, fontWeight: 700, ...T.mono }}>#{b.epoch}</span>
            </div>
            <div style={{ fontSize: 12, color: C.ink, fontWeight: 700, ...T.mono }}>{fmtBnb(b.amount)} BNB</div>
          </div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.06em', ...T.mono,
            color: b.claimable ? C.green : C.muted2,
          }}>{b.claimable ? 'WON' : 'PENDING'}</div>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// BetModal — mirrors Stocks.jsx TradeModal flow:
//   1. User types amount → we compute fee + stake
//   2. Pre-simulate the EXACT call via eth_call
//   3. If sim fails → clean error, never trigger wallet
//   4. If sim passes → "Confirm in your wallet..." → submit
//   5. On success → refetch state
// =====================================================================
function BetModal({ open, onClose, asset, side, epoch, account, onSuccess }) {
  const [amount, setAmount] = useState('');
  const [submitState, setSubmitState] = useState({ kind: 'idle', message: '' });
  const [error, setError]   = useState('');
  const [txInfo, setTxInfo] = useState(null);
  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setAmount(''); setError(''); setTxInfo(null);
      setSubmitState({ kind: 'idle', message: '' });
    }
  }, [open]);

  if (!open) return null;

  // User types TOTAL bnb they want to spend. We skim the fee off the top,
  // forward the remainder to Pancake. Total wallet outflow = typed amount.
  const totalBnb  = parseFloat(amount) || 0;
  const feeBnb    = totalBnb * (ENTRY_FEE_BPS / 10_000);
  const stakeBnb  = totalBnb - feeBnb;
  const tooSmall  = totalBnb > 0 && totalBnb < MIN_BET_BNB;
  const tooLarge  = totalBnb > MAX_BET_BNB;
  const isBusy    = submitState.kind === 'loading';
  const isSuccess = submitState.kind === 'success';
  const isUp      = side === 'UP';
  const chips = [0.001, 0.01, 0.05, 0.1];

  const execute = async () => {
    setError('');

    // ── Validation ──────────────────────────────────────────────────
    if (!ENABLE_TRADING)      return setError('Live trading disabled (set REACT_APP_PANCAKE_LIVE_TRADING=1)');
    if (!account)             return setError('Wallet not connected');
    if (!isAddress(account))  return setError('Invalid account address');
    if (!TREASURY_BSC || !isAddress(TREASURY_BSC)) return setError('Treasury not configured');
    const contractAddress = PREDICTION_CONTRACTS[asset];
    if (!contractAddress || !isAddress(contractAddress)) return setError(`${asset} contract not configured`);
    if (!totalBnb || tooSmall) return setError(`Minimum bet is ${MIN_BET_BNB} BNB`);
    if (tooLarge) return setError(`Maximum bet is ${MAX_BET_BNB} BNB`);

    setSubmitState({ kind: 'loading', message: 'Building transaction...' });

    try {
      // toFixed(18) avoids floating-point precision issues with parseEther
      const stakeWei = parseEther(stakeBnb.toFixed(18));
      const feeWei   = parseEther(feeBnb.toFixed(18));

      const calldata = encodeFunctionData({
        abi: PREDICTION_ABI,
        functionName: isUp ? 'betBull' : 'betBear',
        args: [BigInt(epoch)],
      });

      // ── Pre-simulate the bet via eth_call ────────────────────────
      // Catches: round closed, paused, below contract minBet, duplicate bet.
      setSubmitState({ kind: 'loading', message: 'Checking round...' });
      const sim = await simulateBet({
        from:            account,
        contractAddress, calldata,
        valueWei:        stakeWei,
      });
      if (!sim.ok) throw new Error(sim.message || 'Simulation failed');

      // ── Bundle bet + fee in one signature flow ───────────────────
      setSubmitState({ kind: 'loading', message: 'Confirm in your wallet...' });
      const result = await sendBundledTxs({
        from: account,
        calls: [
          { to: contractAddress, valueWei: stakeWei, data: calldata },
          { to: TREASURY_BSC,    valueWei: feeWei,   data: '0x' },
        ],
      });

      setTxInfo(result);
      setSubmitState({ kind: 'success', message: 'Bet placed.' });
      onSuccess?.();
      setTimeout(() => onClose(), 2200);
    } catch (e) {
      console.error('[pancake bet]', e);
      const friendly = parseEvmRevert(e);
      setError(friendly);
      setSubmitState({ kind: 'error', message: friendly });
      setTimeout(() => setSubmitState({ kind: 'idle', message: '' }), 4000);
    }
  };

  return (
    <>
      <div onClick={isBusy ? undefined : onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(12px)',
        cursor: isBusy ? 'wait' : 'pointer',
      }}/>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 520, zIndex: 401,
        background: C.card, borderTop: `2px solid ${C.borderHi}`,
        borderRadius: '20px 20px 0 0',
        maxHeight: '85dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 -20px 60px rgba(0,0,0,.9)',
      }}>
        <div style={{ flexShrink: 0, padding: '16px 22px 12px' }}>
          <div onClick={isBusy ? undefined : onClose} style={{
            width: 40, height: 4, background: '#2e3f5e', borderRadius: 2,
            margin: '0 auto 18px', cursor: isBusy ? 'wait' : 'pointer',
            padding: '8px 0', boxSizing: 'content-box',
          }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AssetIcon symbol={asset} size={42}/>
            <div>
              <div style={{ fontSize: 10, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>
                BET · ROUND #{epoch}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.inkStr, marginTop: 2, letterSpacing: '-.02em', ...T.display }}>
                {asset} closes {isUp ? 'HIGHER' : 'LOWER'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 14px', minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>YOU PAY (BNB)</span>
              <span style={{
                fontSize: 9, color: C.accent, fontWeight: 700,
                background: 'rgba(0,229,255,.10)', border: `1px solid ${C.borderHi}`,
                padding: '3px 8px', borderRadius: 6, ...T.mono,
              }}>{(ENTRY_FEE_BPS / 100).toFixed(2)}% FEE</span>
            </div>
            <div style={{
              background: 'rgba(255,255,255,.03)',
              border: `1px solid ${tooSmall || tooLarge ? 'rgba(255,59,107,.4)' : C.border}`,
              borderRadius: 12, padding: '13px 14px', marginBottom: 9,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <input
                value={amount}
                onChange={e => { setAmount(cleanAmount(e.target.value)); setError(''); }}
                placeholder="0.0"
                disabled={isBusy}
                inputMode="decimal"
                style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, fontWeight: 800, color: C.inkStr, outline: 'none', ...T.display }}
              />
              <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>BNB</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {chips.map(c => (
                <button key={c} onClick={() => { setAmount(String(c)); setError(''); }} disabled={isBusy} style={{
                  flex: 1, padding: '8px', borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,.02)',
                  color: C.muted, fontWeight: 700, fontSize: 11,
                  cursor: 'pointer', ...T.mono,
                }}>{c}</button>
              ))}
            </div>
            {tooSmall && <div style={{ marginTop: 8, fontSize: 11, color: C.red, fontWeight: 700, ...T.body }}>Minimum is {MIN_BET_BNB} BNB</div>}
            {tooLarge && <div style={{ marginTop: 8, fontSize: 11, color: C.red, fontWeight: 700, ...T.body }}>Maximum is {MAX_BET_BNB} BNB</div>}
          </div>

          {totalBnb > 0 && !tooSmall && !tooLarge && (
            <div style={{
              background: 'rgba(255,255,255,.02)', border: `1px solid ${C.border}`,
              borderRadius: 12, padding: '12px 14px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.08em', marginBottom: 10, ...T.mono }}>BREAKDOWN</div>
              {[
                ['Total',                                          `${fmtBnb(totalBnb)} BNB`],
                [`Service fee ${(ENTRY_FEE_BPS / 100).toFixed(2)}%`, `-${fmtBnb(feeBnb)} BNB`],
                ['Stake (to Pancake)',                              `${fmtBnb(stakeBnb)} BNB`],
              ].map(([l, v], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < a.length - 1 ? `1px solid ${C.hairline}` : 'none' }}>
                  <span style={{ color: C.muted, fontSize: 12, ...T.body }}>{l}</span>
                  <span style={{ color: C.ink, fontSize: 12, fontWeight: 700, ...T.mono }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          flexShrink: 0,
          padding: '12px 22px calc(env(safe-area-inset-bottom) + 24px)',
          borderTop: `1px solid ${C.hairline}`, background: C.card,
        }}>
          {submitState.kind === 'loading' && submitState.message && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: 'rgba(0,229,255,.05)', border: `1px solid ${C.borderHi}`,
              borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,229,255,.2)', borderTopColor: C.accent, animation: 'wc-spin 0.8s linear infinite' }}/>
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600, ...T.body }}>{submitState.message}</span>
            </div>
          )}
          {error && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.24)',
              borderRadius: 10, fontSize: 12, color: C.red, ...T.body,
            }}>{error}</div>
          )}
          {txInfo && isSuccess && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: 'rgba(0,255,163,.08)', border: '1px solid rgba(0,255,163,.24)',
              borderRadius: 10, fontSize: 11, color: C.green, ...T.mono,
            }}>
              {txInfo.type === 'batched' ? 'Batched atomically' : `Sent ${txInfo.hashes.length} txs`}
            </div>
          )}

          <button onClick={execute} disabled={isBusy || !amount || tooSmall || tooLarge} style={{
            width: '100%', padding: 16, borderRadius: 12, border: 'none',
            background: isSuccess
              ? `linear-gradient(135deg,${C.green},${C.accent})`
              : isUp
              ? `linear-gradient(135deg,${C.green},${C.accent})`
              : `linear-gradient(135deg,${C.red},${C.accent2})`,
            color: C.bg, fontWeight: 800, fontSize: 15,
            cursor: isBusy || !amount || tooSmall || tooLarge ? 'not-allowed' : 'pointer',
            minHeight: 52, opacity: !amount || tooSmall || tooLarge ? 0.55 : 1, ...T.display,
          }}>
            {isBusy ? 'Processing…'
              : isSuccess ? 'Bet placed'
              : `Bet ${side} · ${totalBnb > 0 ? fmtBnb(totalBnb) + ' BNB' : '...'}`}
          </button>
        </div>
      </div>
    </>
  );
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================
export default function PancakePredict() {
  const [account, setAccount]         = useState(null);
  const [chainId, setChainId]         = useState(null);
  const [activeAsset, setActiveAsset] = useState('BNB');
  const [roundState, setRoundState]   = useState(null);
  const [userBets, setUserBets]       = useState([]);
  const [betOpen, setBetOpen]         = useState(false);
  const [betCtx, setBetCtx]           = useState(null);
  const [claiming, setClaiming]       = useState(false);
  const [error, setError]             = useState('');
  const [refetchTick, setRefetchTick] = useState(0);  // bumped after bet/claim

  const walletName = useMemo(detectWalletName, []);
  const onBsc      = chainId === BSC_CHAIN_ID;
  const isStale    = roundState?.fetchedAt
    ? (Date.now() - roundState.fetchedAt) > STALE_STATE_MS
    : false;
  const [, forceStaleCheck] = useState(0);

  // Re-render every 5s so isStale stays accurate even if the polling fails
  useEffect(() => {
    const id = setInterval(() => forceStaleCheck(x => x + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const tradingConfigured = Boolean(
    ENABLE_TRADING && TREASURY_BSC && isAddress(TREASURY_BSC)
  );

  // ── Wallet event listeners ──────────────────────────────────────────
  useEffect(() => {
    const p = getInjectedProvider();
    if (!p) return;
    const onAccountsChanged = accs => setAccount(accs?.[0] || null);
    const onChainChanged    = hex  => setChainId(parseInt(hex, 16));
    p.on?.('accountsChanged', onAccountsChanged);
    p.on?.('chainChanged',    onChainChanged);
    (async () => {
      try {
        const accs = await p.request({ method: 'eth_accounts' });
        if (accs?.[0]) setAccount(accs[0]);
        setChainId(await evmCurrentChainId());
      } catch {}
    })();
    return () => {
      p.removeListener?.('accountsChanged', onAccountsChanged);
      p.removeListener?.('chainChanged',    onChainChanged);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setError('');
    try {
      if (!getInjectedProvider()) {
        setError('No EVM wallet found. Install MetaMask, Rabby, or Trust Wallet.');
        return;
      }
      const accs = await evmRequestAccounts();
      setAccount(accs?.[0] || null);
      setChainId(await evmCurrentChainId());
    } catch (e) {
      if (e?.code === 4001) return;
      setError(e?.message || 'Connection failed');
    }
  }, []);

  const handleSwitchNetwork = useCallback(async () => {
    setError('');
    try { await evmSwitchToBsc(); }
    catch (e) {
      if (e?.code === 4001) return;
      setError(e?.message || 'Network switch failed');
    }
  }, []);

  // ── Round state polling (every 5s) ──────────────────────────────────
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const state = await fetchRoundState(activeAsset);
      if (alive && state) setRoundState(state);
    };
    tick();
    const id = setInterval(tick, ROUND_REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [activeAsset, refetchTick]);

  // ── User bets polling (every 15s) ───────────────────────────────────
  const refreshBets = useCallback(async () => {
    if (!account || !ENABLE_TRADING) { setUserBets([]); return; }
    const allBets = [];
    for (const asset of ['BNB', 'BTC', 'ETH']) {
      if (!PREDICTION_CONTRACTS[asset]) continue;
      const bets = await fetchRecentUserBets(asset, account, 10);
      allBets.push(...bets);
    }
    setUserBets(allBets);
  }, [account]);

  useEffect(() => {
    if (!account) return;
    refreshBets();
    const id = setInterval(refreshBets, BETS_REFRESH_MS);
    return () => clearInterval(id);
  }, [account, refreshBets, refetchTick]);

  // ── Bet trigger ─────────────────────────────────────────────────────
  const handleBet = (asset, side, epoch) => {
    setError('');
    if (!account) { handleConnect(); return; }
    if (!onBsc)   { handleSwitchNetwork(); return; }
    setBetCtx({ asset, side, epoch });
    setBetOpen(true);
  };

  // ── Claim flow ──────────────────────────────────────────────────────
  // Claim through our site = we sequentially call claim() and then the
  // win-fee transfer. Win fee is 10% of estimated payout per round.
  //
  // Sequential is intentional: claim() pays winnings to user's wallet,
  // THEN we send fee. If user cancels the fee tx, they kept their
  // winnings — we just don't get the fee. Acceptable leak vs custodial
  // alternatives.
  const handleClaim = async (bets) => {
    if (!bets?.length || !account) return;
    if (!onBsc) { handleSwitchNetwork(); return; }

    // Group epochs by asset (one claim() call per contract)
    const byAsset = {};
    bets.forEach(b => { (byAsset[b.asset] = byAsset[b.asset] || []).push(b.epoch); });

    setClaiming(true);
    setError('');

    try {
      let totalPayoutWei = 0n;

      // Estimate total expected payout across all claimed rounds → for win fee
      for (const b of bets) {
        const payout = await fetchExpectedPayout(b.asset, b.epoch, account);
        totalPayoutWei += payout;
      }

      // Build claim calls (one per asset contract) + one fee call
      const calls = [];
      for (const [asset, epochs] of Object.entries(byAsset)) {
        const address = PREDICTION_CONTRACTS[asset];
        if (!address) continue;
        const calldata = encodeFunctionData({
          abi: PREDICTION_ABI,
          functionName: 'claim',
          args: [epochs.map(e => BigInt(e))],
        });

        // Pre-sim each claim — bail before triggering wallet if any would revert
        const sim = await simulateClaim({ from: account, contractAddress: address, calldata });
        if (!sim.ok) throw new Error(sim.message || 'Claim simulation failed');

        calls.push({ to: address, valueWei: 0n, data: calldata });
      }

      // Append win fee transfer if applicable
      const winFeeWei = (totalPayoutWei * BigInt(WIN_FEE_BPS)) / 10000n;
      if (winFeeWei > 0n && TREASURY_BSC && isAddress(TREASURY_BSC)) {
        calls.push({ to: TREASURY_BSC, valueWei: winFeeWei, data: '0x' });
      }

      await sendBundledTxs({ from: account, calls });
      setRefetchTick(t => t + 1);
    } catch (e) {
      const friendly = parseEvmRevert(e);
      if (friendly !== 'Cancelled') setError(friendly);
    } finally {
      setClaiming(false);
    }
  };

  const totalPool      = roundState?.live?.totalAmount || 0;
  const claimableCount = userBets.filter(b => b.claimable && !b.claimed).length;

  return (
    <>
      <style>{`@keyframes pancake-pulse { 0%,100%{opacity:1}50%{opacity:.4} } @keyframes wc-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', color: C.ink, ...T.display }}>

        {/* HERO */}
        <div style={{
          marginBottom: 16, padding: '20px 18px', borderRadius: 16,
          background: C.card, border: `1px solid ${C.border}`,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -40, top: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle,${C.pcsYellow}18,transparent 65%)`, pointerEvents: 'none' }}/>
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '4px 10px', borderRadius: 999,
              background: 'rgba(240,185,11,.08)', border: '1px solid rgba(240,185,11,.22)',
              marginBottom: 14,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.pcsYellow, boxShadow: `0 0 10px ${C.pcsYellow}`, animation: 'pancake-pulse 2s ease-in-out infinite' }}/>
              <span style={{ color: C.pcsYellow, fontSize: 9, fontWeight: 700, letterSpacing: '.10em', ...T.mono }}>
                BNB CHAIN · POWERED BY PANCAKESWAP
              </span>
            </div>
            <h1 style={{
              fontSize: 28, lineHeight: 1.05, fontWeight: 800,
              color: C.inkStr, margin: '0 0 6px', letterSpacing: '-.03em', ...T.display,
            }}>Pancake Predict</h1>
            <p style={{ color: C.muted, fontSize: 12.5, margin: '0 0 14px', fontWeight: 500, ...T.body }}>
              5-minute price predictions. Bet UP or DOWN, winners split the pool.
            </p>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(0,0,0,.3)', border: `1px solid ${C.border}`,
            }}>
              {[
                { label: 'POOL',   value: fmtBnb(totalPool, 2) + ' BNB' },
                { label: 'ROUND',  value: roundState ? `#${roundState.live?.epoch || '-'}` : '-' },
                { label: 'CLAIMS', value: claimableCount },
              ].map((s, i) => (
                <div key={s.label} style={{
                  textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
                  borderRight: i < 2 ? `1px solid ${C.hairline}` : 'none',
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.inkStr, ...T.display }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: C.muted2, marginTop: 3, fontWeight: 700, letterSpacing: '.08em', ...T.mono }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* WALLET STATUS BAR */}
        <div style={{
          marginBottom: 14, padding: '11px 14px', borderRadius: 12,
          background: account
            ? (onBsc ? 'rgba(0,255,163,.05)' : 'rgba(255,184,77,.05)')
            : 'rgba(255,255,255,.02)',
          border: `1px solid ${account ? (onBsc ? 'rgba(0,255,163,.24)' : 'rgba(255,184,77,.30)') : C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 9, color: C.muted2, fontWeight: 700, letterSpacing: '.06em', ...T.mono }}>
              {account ? (onBsc ? 'CONNECTED · BNB CHAIN' : 'WRONG NETWORK') : 'NOT CONNECTED'}
            </div>
            <div style={{ fontSize: 12, color: C.inkStr, fontWeight: 700, marginTop: 3, ...T.mono }}>
              {account ? shortAddr(account) : walletName ? `${walletName} detected` : 'No EVM wallet'}
            </div>
          </div>
          {!account ? (
            <button onClick={handleConnect} style={{
              padding: '8px 14px', borderRadius: 99, border: 'none',
              background: `linear-gradient(135deg,${C.accent},${C.accent2})`,
              color: C.bg, fontWeight: 800, fontSize: 12, cursor: 'pointer', ...T.display,
            }}>Connect</button>
          ) : !onBsc ? (
            <button onClick={handleSwitchNetwork} style={{
              padding: '8px 14px', borderRadius: 99, border: 'none',
              background: `linear-gradient(135deg,${C.amber},${C.pcsYellow})`,
              color: C.bg, fontWeight: 800, fontSize: 12, cursor: 'pointer', ...T.display,
            }}>Switch to BSC</button>
          ) : (
            <button onClick={() => setAccount(null)} style={{
              padding: '8px 12px', borderRadius: 99,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer', ...T.mono,
            }}>Disconnect</button>
          )}
        </div>

        {error && (
          <div style={{
            marginBottom: 14, padding: 10, borderRadius: 10,
            background: 'rgba(255,59,107,.08)', border: '1px solid rgba(255,59,107,.24)',
            fontSize: 12, color: C.red, ...T.body,
          }}>{error}</div>
        )}

        <PositionsPanel bets={userBets} onClaim={handleClaim} claiming={claiming}/>

        {/* ASSET SWITCHER */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
          {ASSETS.map(a => (
            <button key={a.id}
              onClick={() => a.enabled && setActiveAsset(a.id)}
              disabled={!a.enabled}
              style={{
                padding: '7px 13px', borderRadius: 99,
                border: `1px solid ${activeAsset === a.id ? C.borderHi : C.border}`,
                background: activeAsset === a.id ? 'rgba(0,229,255,.09)' : 'rgba(255,255,255,.02)',
                color: !a.enabled ? C.muted2 : activeAsset === a.id ? C.accent : C.muted,
                fontSize: 11, fontWeight: 700,
                cursor: a.enabled ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap', flexShrink: 0,
                opacity: a.enabled ? 1 : 0.4, ...T.display,
              }}>
              {a.label}
              {!a.enabled && <span style={{ marginLeft: 6, fontSize: 8, ...T.mono }}>SOON</span>}
            </button>
          ))}
        </div>

        {!tradingConfigured && (
          <div style={{
            marginBottom: 14, padding: 10, borderRadius: 10,
            background: 'rgba(255,184,77,.08)', border: '1px solid rgba(255,184,77,.30)',
            fontSize: 12, color: C.amber, fontWeight: 600, ...T.body,
          }}>
            Trading not configured — set <code style={{ fontSize: 10, ...T.mono }}>REACT_APP_PANCAKE_LIVE_TRADING=1</code> and <code style={{ fontSize: 10, ...T.mono }}>REACT_APP_PANCAKE_TREASURY_BSC</code>.
          </div>
        )}

        {isStale && roundState && (
          <div style={{
            marginBottom: 14, padding: 10, borderRadius: 10,
            background: 'rgba(255,184,77,.08)', border: '1px solid rgba(255,184,77,.30)',
            fontSize: 12, color: C.amber, fontWeight: 600, ...T.body,
          }}>Round data is stale. Reconnecting to BSC RPC…</div>
        )}

        {roundState ? (
          <LiveRoundCard state={roundState} onBet={handleBet} account={account} onBsc={onBsc} isStale={isStale}/>
        ) : (
          <div style={{
            padding: '30px 16px', borderRadius: 16, textAlign: 'center',
            background: C.card, border: `1px solid ${C.border}`,
            color: C.muted, fontSize: 12, ...T.body,
          }}>Loading round state from BSC…</div>
        )}

        <div style={{
          fontSize: 9.5, color: C.muted2, lineHeight: 1.5,
          textAlign: 'center', padding: '12px 8px',
          marginTop: 6,
        }}>
          Bets settle on PancakeSwap Prediction on BNB Chain. {(ENTRY_FEE_BPS / 100).toFixed(2)}% service fee on entry, {(WIN_FEE_BPS / 100).toFixed(0)}% on winnings claimed through this site.
        </div>

        <BetModal
          open={betOpen}
          onClose={() => setBetOpen(false)}
          asset={betCtx?.asset}
          side={betCtx?.side}
          epoch={betCtx?.epoch}
          account={account}
          onSuccess={() => setRefetchTick(t => t + 1)}
        />
      </div>
    </>
  );
}
