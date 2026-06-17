// src/hooks/useFlipsy.js — pure public + free.
//
// READS  → race across multiple public devnet RPCs (Promise.any).
//          One anchor Program per RPC; .fetch / .all are raced.
// WRITES → pinned to the official Solana devnet RPC (most reliable
//          for tx propagation and confirmation on devnet).
//
// Honest balance state: `balanceStatus` is 'idle' | 'loading' | 'ok' | 'fail'.
// The UI shows '…' / 'RPC down' / real number — never silent zero.
//
// Price: Coinbase spot endpoint, with a CoinGecko fallback. Both public.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../idl/flipsy.json';

const PROGRAM_ID = new PublicKey('71bEAUToad7j8k8As9LwsGWBYTLxVJoP2SBNB3S3RLHs');

// === PUBLIC DEVNET RPC POOL — no env vars, no API keys ===============
// Reads race across all of these; the fastest healthy one wins.
const DEVNET_RPC_POOL = [
  'https://api.devnet.solana.com',
  'https://solana-devnet-rpc.publicnode.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://solana-devnet.drpc.org',
];
// Writes use the official RPC — devnet's official endpoint is the most
// reliable for tx broadcast/confirmation.
const WRITE_RPC = 'https://api.devnet.solana.com';

// Price feeds (public, free, no key).
const PRICE_URLS = [
  { url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot',
    pick: (j) => parseFloat(j?.data?.amount) },
  { url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    pick: (j) => parseFloat(j?.solana?.usd) },
];

const POLL_PRICE_MS = 5_000;     // gentler — public price APIs rate-limit
const POLL_CHAIN_MS = 6_000;     // gentler — public RPCs rate-limit
const LAMPORTS_PER_SOL = 1_000_000_000;
const PRICE_SCALE = 1e8;
const DEFAULT_BETTING_DURATION = 900;
const DEFAULT_GAP_DURATION = 30;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600;
const RECENT_ROUNDS_COUNT = 10;

if (!idl.address) idl.address = PROGRAM_ID.toBase58();

// ============================================================
// Anchor helpers (unchanged)
// ============================================================
const u64Buf = (n) => new anchor.BN(n).toArrayLike(Buffer, 'le', 8);
const findConfigPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
const findRoundPda = (epoch) =>
  PublicKey.findProgramAddressSync([Buffer.from('round'), u64Buf(epoch)], PROGRAM_ID)[0];
const findVaultPda = (epoch) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), u64Buf(epoch)], PROGRAM_ID)[0];
const findBetPda = (epoch, user, betIndex) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('bet'), u64Buf(epoch), user.toBuffer(), u64Buf(betIndex)],
    PROGRAM_ID,
  )[0];

const bnToNumber = (bn) => {
  if (bn == null) return 0;
  if (typeof bn === 'number') return bn;
  if (typeof bn.toNumber === 'function') {
    try { return bn.toNumber(); } catch (_) { return Number(bn.toString()); }
  }
  return Number(bn);
};
const lamportsToSol = (l) => bnToNumber(l) / LAMPORTS_PER_SOL;
const chainPriceToUsd = (p) => bnToNumber(p) / PRICE_SCALE;
const solToUsd = (sol, pricePerSol) => sol * (pricePerSol || 0);

function toPubkey(x) {
  if (!x) return null;
  if (x instanceof PublicKey) return x;
  if (typeof x === 'string') { try { return new PublicKey(x); } catch (_) { return null; } }
  if (typeof x?.toBase58 === 'function') { try { return new PublicKey(x.toBase58()); } catch (_) { return null; } }
  return null;
}

function outcomeStr(outcome) {
  if (!outcome) return 'unresolved';
  if ('heads' in outcome) return 'heads';
  if ('tails' in outcome) return 'tails';
  if ('tie' in outcome) return 'tie';
  if ('allLost' in outcome) return 'allLost';
  return 'unresolved';
}
const sideToVariant = (s) => s === 'heads' ? { heads: {} } : { tails: {} };

function mapRound(r, livePrice) {
  const headsSol = lamportsToSol(r.headsPool);
  const tailsSol = lamportsToSol(r.tailsPool);
  return {
    epoch: bnToNumber(r.epoch),
    lockPrice: chainPriceToUsd(r.lockPrice),
    closePrice: chainPriceToUsd(r.closePrice),
    startTime: bnToNumber(r.startTime),
    lockTime: bnToNumber(r.lockTime),
    closeTime: bnToNumber(r.closeTime),
    nextStartTime: bnToNumber(r.nextStartTime),
    headsPool: solToUsd(headsSol, livePrice),
    tailsPool: solToUsd(tailsSol, livePrice),
    headsPoolSol: headsSol,
    tailsPoolSol: tailsSol,
    betCount: bnToNumber(r.betCount),
    outcome: outcomeStr(r.outcome),
    resolvedAt: bnToNumber(r.resolvedAt),
    swept: r.swept,
  };
}

function stubRound(epoch, expectedStartTime, bettingDuration, gapDuration) {
  return {
    epoch, lockPrice: 0, closePrice: 0,
    startTime: expectedStartTime,
    lockTime: expectedStartTime + bettingDuration,
    closeTime: expectedStartTime + bettingDuration,
    nextStartTime: expectedStartTime + bettingDuration + gapDuration,
    headsPool: 0, tailsPool: 0, headsPoolSol: 0, tailsPoolSol: 0,
    betCount: 0, outcome: 'unresolved', resolvedAt: 0, swept: false,
  };
}

// ============================================================
// RPC race — Promise.any across the public devnet pool.
// `op(program, connection, url)` runs once per pool entry; whichever
// resolves first wins. Rejects only when ALL pool entries fail.
// ============================================================
function raceAny(label, calls) {
  return Promise.any(calls).catch((agg) => {
    console.warn('[flipsy] all RPCs failed for ' + label, agg?.errors?.[0]?.message);
    throw new Error(label + ': all public RPCs failed');
  });
}

// ============================================================
// Hook
// ============================================================
export function useFlipsy(wallet) {
  // ---- Read pool: one Connection + Program per RPC -----------------
  // Memoised once — these stay stable across renders.
  const readPool = useMemo(() => {
    const dummyWallet = {
      publicKey: PROGRAM_ID,
      signTransaction: async () => { throw new Error('read-only'); },
      signAllTransactions: async () => { throw new Error('read-only'); },
    };
    return DEVNET_RPC_POOL.map((url) => {
      try {
        const connection = new Connection(url, 'confirmed');
        const provider = new anchor.AnchorProvider(
          connection, dummyWallet,
          { commitment: 'confirmed', preflightCommitment: 'confirmed' },
        );
        const program = new anchor.Program(idl, provider);
        return { url, connection, program };
      } catch (e) {
        console.warn('[flipsy] read pool init failed for', url, e?.message);
        return null;
      }
    }).filter(Boolean);
  }, []);

  const [livePrice, setLivePrice] = useState(0);
  const [liveRound, setLiveRound] = useState(null);
  const [upcomingRounds, setUpcomingRounds] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const [userBets, setUserBets] = useState({});
  const [balance, setBalance] = useState(0);
  const [balanceStatus, setBalanceStatus] = useState('idle'); // idle|loading|ok|fail
  const [loading, setLoading] = useState(true);
  const [programConfig, setProgramConfig] = useState(null);
  const [chainError, setChainError] = useState(null);
  const livePriceRef = useRef(0);

  const walletPkStr = useMemo(() => {
    const pk = toPubkey(wallet?.publicKey);
    return pk ? pk.toBase58() : null;
  }, [wallet?.publicKey]);

  // ---- Write program: pinned to official devnet RPC ----------------
  const writeProgram = useMemo(() => {
    if (!walletPkStr) return null;
    if (typeof wallet?.signTransaction !== 'function') return null;
    try {
      const pk = new PublicKey(walletPkStr);
      const connection = new Connection(WRITE_RPC, 'confirmed');
      const wrappedWallet = {
        publicKey: pk,
        signTransaction: wallet.signTransaction.bind(wallet),
        signAllTransactions:
          typeof wallet.signAllTransactions === 'function'
            ? wallet.signAllTransactions.bind(wallet)
            : async (txs) => Promise.all(txs.map((t) => wallet.signTransaction(t))),
      };
      const provider = new anchor.AnchorProvider(
        connection, wrappedWallet,
        { commitment: 'confirmed', preflightCommitment: 'confirmed' },
      );
      return new anchor.Program(idl, provider);
    } catch (e) {
      console.error('[flipsy] writeProgram init failed:', e);
      queueMicrotask(() => setChainError('Wallet init failed: ' + (e?.message || e)));
      return null;
    }
  }, [walletPkStr, wallet?.signTransaction]);

  // ============================================================
  // Race helpers, built over the read pool
  // ============================================================
  const raceFetchAccount = useCallback(async (label, kind, pda) => {
    if (!readPool.length) throw new Error('No read RPCs available');
    return raceAny(label, readPool.map(p => p.program.account[kind].fetch(pda)));
  }, [readPool]);

  const raceGetAccountInfo = useCallback(async (label, pda) => {
    if (!readPool.length) throw new Error('No read RPCs available');
    return raceAny(label, readPool.map(p => p.connection.getAccountInfo(pda)));
  }, [readPool]);

  const raceAllBets = useCallback(async (filters) => {
    if (!readPool.length) throw new Error('No read RPCs available');
    return raceAny('bets.all', readPool.map(p => p.program.account.bet.all(filters)));
  }, [readPool]);

  const raceGetBalance = useCallback(async (pk) => {
    if (!readPool.length) throw new Error('No read RPCs available');
    return raceAny('getBalance', readPool.map(p => p.connection.getBalance(pk)));
  }, [readPool]);

  // ============================================================
  // Price polling (public, free, with fallback)
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    async function fetchPrice() {
      for (const src of PRICE_URLS) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(src.url, { signal: ctrl.signal });
          clearTimeout(t);
          if (!res.ok) continue;
          const json = await res.json();
          const p = src.pick(json);
          if (!cancelled && Number.isFinite(p) && p > 0) {
            setLivePrice(p);
            livePriceRef.current = p;
            return;
          }
        } catch (_) {}
      }
    }
    fetchPrice();
    const i = setInterval(fetchPrice, POLL_PRICE_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  // ============================================================
  // Chain state polling — all reads raced across the public pool
  // ============================================================
  useEffect(() => {
    if (!readPool.length) {
      setChainError('No public devnet RPCs configured');
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function fetchState() {
      try {
        const configPda = findConfigPda();

        // Probe existence first — racing getAccountInfo across pool.
        const configInfo = await raceGetAccountInfo('config', configPda);
        if (!configInfo) {
          throw new Error('Flipsy config not found at ' + configPda.toBase58() + '. Program may not be deployed/initialised on devnet.');
        }

        const config = await raceFetchAccount('config', 'config', configPda);
        const currentEpoch = bnToNumber(config.currentEpoch);
        const price = livePriceRef.current;

        const bettingDuration = bnToNumber(config.bettingDuration) || DEFAULT_BETTING_DURATION;
        const gapDuration = bnToNumber(config.gapDuration) || DEFAULT_GAP_DURATION;
        const claimForfeitDelay = bnToNumber(config.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;

        // Current/live round
        let live = null;
        if (currentEpoch > 0) {
          try {
            const r = await raceFetchAccount('round-' + currentEpoch, 'round', findRoundPda(currentEpoch));
            live = mapRound(r, price);
            if (live.outcome !== 'unresolved') live = null;
          } catch (_) {}
        }

        // Upcoming rounds (next 3)
        const upcomingEpochs = [currentEpoch + 1, currentEpoch + 2, currentEpoch + 3];
        const liveCloseTime = live?.closeTime || Math.floor(Date.now() / 1000) + bettingDuration;
        const baseStart = liveCloseTime + gapDuration;
        const upcoming = await Promise.all(
          upcomingEpochs.map(async (e, idx) => {
            try {
              const r = await raceFetchAccount('round-' + e, 'round', findRoundPda(e));
              const m = mapRound(r, price);
              return m.outcome !== 'unresolved' ? null : m;
            } catch (_) {
              const start = baseStart + idx * (bettingDuration + gapDuration);
              return stubRound(e, start, bettingDuration, gapDuration);
            }
          }),
        );

        if (live) live._claimForfeitDelay = claimForfeitDelay;

        // Recent rounds
        const recentEpochs = [];
        for (let i = 1; i <= RECENT_ROUNDS_COUNT; i++) {
          if (currentEpoch - i > 0) recentEpochs.push(currentEpoch - i);
        }
        const allRecent = currentEpoch > 0 ? [currentEpoch, ...recentEpochs] : recentEpochs;
        const recents = await Promise.all(
          allRecent.map(async (e) => {
            try {
              const r = await raceFetchAccount('round-' + e, 'round', findRoundPda(e));
              const m = mapRound(r, price);
              return m.outcome === 'unresolved' ? null : m;
            } catch (_) { return null; }
          }),
        );

        // User bets
        const walletPk = toPubkey(wallet?.publicKey);
        let userBetsMap = {};
        if (walletPk) {
          try {
            const bets = await raceAllBets([
              { memcmp: { offset: 8, bytes: walletPk.toBase58() } },
            ]);
            for (const b of bets) {
              const epoch = bnToNumber(b.account.epoch);
              const sol = lamportsToSol(b.account.amount);
              const betObj = {
                side: 'heads' in b.account.side ? 'heads' : 'tails',
                amount: solToUsd(sol, price),
                amountSol: sol,
                claimed: b.account.claimed,
                betIndex: bnToNumber(b.account.betIndex),
                pubkey: b.publicKey,
              };
              if (!userBetsMap[epoch]) userBetsMap[epoch] = [];
              userBetsMap[epoch].push(betObj);
            }
          } catch (e) { console.warn('[flipsy] user bets:', e?.message); }
        }

        // Wallet balance — independent race so it stays accurate even
        // when other RPC calls fail intermittently.
        let walletBalanceUsd = 0;
        let balOk = false;
        if (walletPk) {
          try {
            const lamports = await raceGetBalance(walletPk);
            walletBalanceUsd = solToUsd(lamportsToSol(lamports), price);
            balOk = true;
          } catch (e) { console.warn('[flipsy] wallet balance:', e?.message); }
        } else {
          balOk = true; // not connected — '0' is honestly correct
        }

        if (cancelled) return;
        setLiveRound(live);
        setUpcomingRounds(upcoming.filter(Boolean));
        setRecentRounds(recents.filter(Boolean));
        setUserBets(userBetsMap);
        setBalance(walletBalanceUsd);
        setBalanceStatus(balOk ? 'ok' : 'fail');
        setProgramConfig({
          minBet: bnToNumber(config.minBet),
          maxBet: bnToNumber(config.maxBet),
          feeBps: bnToNumber(config.feeBps),
          bettingDuration, gapDuration,
          maxFutureRounds: bnToNumber(config.maxFutureRounds),
          claimForfeitDelay,
          paused: config.paused,
        });
        setChainError(null);
      } catch (e) {
        console.error('[flipsy] state fetch error:', e);
        if (!cancelled) {
          setChainError(e?.message || String(e) || 'Failed to load on-chain state');
          setBalanceStatus('fail');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setBalanceStatus(prev => prev === 'idle' ? 'loading' : prev);
    fetchState();
    const i = setInterval(fetchState, POLL_CHAIN_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, [readPool, walletPkStr, raceFetchAccount, raceGetAccountInfo, raceAllBets, raceGetBalance, wallet]);

  // ============================================================
  // Writes (placeBet / claim) — anchor handles tx via writeProgram
  // ============================================================
  const placeBet = useCallback(async (epoch, side, usdAmount) => {
    if (!writeProgram) throw new Error('Connect your wallet first');
    const walletPk = toPubkey(wallet?.publicKey);
    if (!walletPk) throw new Error('Wallet public key unavailable');
    const price = livePriceRef.current;
    if (!price) throw new Error('Price not loaded yet, try again in a sec');

    const lamports = Math.floor((usdAmount / price) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('Invalid bet amount');

    const existing = userBets[epoch] || [];
    const betIndex = existing.length > 0 ? Math.max(...existing.map(b => b.betIndex)) + 1 : 0;

    try {
      return await writeProgram.methods
        .placeBet(new anchor.BN(epoch), new anchor.BN(betIndex), new anchor.BN(lamports), sideToVariant(side))
        .accounts({
          config: findConfigPda(),
          round: findRoundPda(epoch),
          vault: findVaultPda(epoch),
          bet: findBetPda(epoch, walletPk, betIndex),
          user: walletPk,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      const msg = e?.error?.errorMessage || e?.message || 'Bet failed';
      console.error('[flipsy] placeBet:', e);
      throw new Error(msg);
    }
  }, [writeProgram, wallet, userBets]);

  const claim = useCallback(async (epoch) => {
    if (!writeProgram) throw new Error('Connect your wallet first');
    const walletPk = toPubkey(wallet?.publicKey);
    if (!walletPk) throw new Error('Wallet public key unavailable');

    const bets = (userBets[epoch] || []).filter(b => !b.claimed);
    if (bets.length === 0) throw new Error('No claimable bets for that round');

    const roundPda = findRoundPda(epoch);
    let resolvedAt = 0;
    let claimForfeitDelay = DEFAULT_CLAIM_FORFEIT_DELAY;
    try {
      const r = await writeProgram.account.round.fetch(roundPda);
      resolvedAt = bnToNumber(r.resolvedAt);
    } catch (e) { console.warn('[flipsy] round fetch:', e?.message); }

    const configPda = findConfigPda();
    let superAdmin;
    try {
      const cfg = await writeProgram.account.config.fetch(configPda);
      superAdmin = toPubkey(cfg.admin || cfg.authority);
      claimForfeitDelay = bnToNumber(cfg.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;
    } catch (e) { throw new Error('Failed to load program config'); }
    if (!superAdmin) throw new Error('Program superAdmin missing');

    const nowTs = Math.floor(Date.now() / 1000);
    if (resolvedAt > 0 && nowTs > resolvedAt + claimForfeitDelay) {
      throw new Error('Claim window expired — winnings forfeited');
    }

    const vaultPda = findVaultPda(epoch);
    let lastTx = null;
    for (const bet of bets) {
      try {
        lastTx = await writeProgram.methods
          .claim()
          .accounts({
            config: configPda, round: roundPda,
            bet: findBetPda(epoch, walletPk, bet.betIndex),
            vault: vaultPda, superAdmin, user: walletPk,
          })
          .rpc();
      } catch (e) {
        const msg = e?.error?.errorMessage || e?.message || 'Claim failed';
        console.error('[flipsy] claim:', e);
        throw new Error(msg);
      }
    }
    return lastTx;
  }, [writeProgram, wallet, userBets]);

  return {
    livePrice, liveRound, upcomingRounds, recentRounds, userBets,
    balance, balanceStatus,
    placeBet, claim, loading, programConfig, chainError,
  };
}
 