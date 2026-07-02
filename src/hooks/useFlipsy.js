/* ============================================================================
 * useFlipsy.js — BRACKETS REWORK (read me)
 * ----------------------------------------------------------------------------
 * Matches the bracket version of lib.rs:
 *  - Rounds expose FOUR pools (upSmall, upBig, downSmall, downBig) instead of
 *    heads/tails. mapRound() now returns { pools, poolsSol, totalPool, ... }.
 *  - Bets carry a `bracket` ('upSmall'|'upBig'|'downSmall'|'downBig'), not a side.
 *  - placeBet(epoch, bracket, usdAmount).
 *  - outcome can be 'upSmall'|'upBig'|'downSmall'|'downBig'|'tie'|'allLost'|'unresolved'.
 *  - Betting locks 60s before close on a LIVE round (contract enforces it via
 *    lock_time). The hook surfaces lockTime/closeTime; the UI decides bettability.
 *  - Live price = Coinbase SOL-USD spot, the SAME source the crank uses for
 *    lock/close, so the on-screen delta tracks the resolved bracket.
 *  - PROGRAM_ID from process.env.REACT_APP_FLIPSY_PROGRAM_ID (system-program
 *    placeholder). Set it to your deployed program ID at build time.
 *  - NOTE: Flipsy.jsx still needs its UI updated to consume brackets (this hook's
 *    return shape changed). That's the UI pass.
 * ==========================================================================*/
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey(
  process.env.REACT_APP_FLIPSY_PROGRAM_ID || '11111111111111111111111111111111',
);

// RPC — public Solana devnet endpoint (Flipsy is deployed on devnet).
const FLIPSY_RPC = 'https://api.devnet.solana.com';

const PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';
const POLL_PRICE_MS = 2_500;
const POLL_CHAIN_MS = 5_000;
const LAMPORTS_PER_SOL = 1_000_000_000;
const PRICE_SCALE = 1e8;
const DEFAULT_BETTING_DURATION = 300;   // 5 min (fallback only; real value on-chain)
const DEFAULT_GAP_DURATION = 30;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600;
// Matches BET_LOCK_LEAD in lib.rs — betting on a live round stops this many
// seconds before close. Program constant, not stored in Config.
const BET_LOCK_LEAD = 60;
const RECENT_ROUNDS_COUNT = 10;

const BRACKETS = ['upSmall', 'upBig', 'downSmall', 'downBig'];

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

// Anchor serializes enum variants as an object with a single camelCase key.
function outcomeStr(outcome) {
  if (!outcome) return 'unresolved';
  if ('upSmall' in outcome) return 'upSmall';
  if ('upBig' in outcome) return 'upBig';
  if ('downSmall' in outcome) return 'downSmall';
  if ('downBig' in outcome) return 'downBig';
  if ('tie' in outcome) return 'tie';
  if ('allLost' in outcome) return 'allLost';
  return 'unresolved';
}
function bracketStr(bracket) {
  if (!bracket) return 'upSmall';
  if ('upSmall' in bracket) return 'upSmall';
  if ('upBig' in bracket) return 'upBig';
  if ('downSmall' in bracket) return 'downSmall';
  if ('downBig' in bracket) return 'downBig';
  return 'upSmall';
}
const bracketToVariant = (b) => ({
  upSmall: { upSmall: {} },
  upBig: { upBig: {} },
  downSmall: { downSmall: {} },
  downBig: { downBig: {} },
}[b] || { upSmall: {} });

function mapRound(r, livePrice) {
  const sol = {
    upSmall: lamportsToSol(r.upSmallPool),
    upBig: lamportsToSol(r.upBigPool),
    downSmall: lamportsToSol(r.downSmallPool),
    downBig: lamportsToSol(r.downBigPool),
  };
  const totalSol = sol.upSmall + sol.upBig + sol.downSmall + sol.downBig;
  return {
    epoch: bnToNumber(r.epoch),
    lockPrice: chainPriceToUsd(r.lockPrice),
    closePrice: chainPriceToUsd(r.closePrice),
    startTime: bnToNumber(r.startTime),
    lockTime: bnToNumber(r.lockTime),
    closeTime: bnToNumber(r.closeTime),
    nextStartTime: bnToNumber(r.nextStartTime),
    pools: {
      upSmall: solToUsd(sol.upSmall, livePrice),
      upBig: solToUsd(sol.upBig, livePrice),
      downSmall: solToUsd(sol.downSmall, livePrice),
      downBig: solToUsd(sol.downBig, livePrice),
    },
    poolsSol: sol,
    totalPool: solToUsd(totalSol, livePrice),
    totalPoolSol: totalSol,
    betCount: bnToNumber(r.betCount),
    outcome: outcomeStr(r.outcome),
    resolvedAt: bnToNumber(r.resolvedAt),
    swept: r.swept,
  };
}

function stubRound(epoch, expectedStartTime, bettingDuration, gapDuration, lockLead) {
  const close = expectedStartTime + bettingDuration;
  return {
    epoch, lockPrice: 0, closePrice: 0,
    startTime: expectedStartTime,
    lockTime: Math.max(expectedStartTime, close - lockLead),
    closeTime: close,
    nextStartTime: close + gapDuration,
    pools: { upSmall: 0, upBig: 0, downSmall: 0, downBig: 0 },
    poolsSol: { upSmall: 0, upBig: 0, downSmall: 0, downBig: 0 },
    totalPool: 0, totalPoolSol: 0,
    betCount: 0, outcome: 'unresolved', resolvedAt: 0, swept: false,
  };
}

export function useFlipsy(wallet) {
  const connection = useMemo(
    () => new Connection(FLIPSY_RPC, 'confirmed'),
    [],
  );
  const [idl, setIdl] = useState(null);

  const [livePrice, setLivePrice] = useState(0);
  const [liveRound, setLiveRound] = useState(null);
  const [upcomingRounds, setUpcomingRounds] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const [userBets, setUserBets] = useState({});
  const [balance, setBalance] = useState(0);
  const [balanceStatus, setBalanceStatus] = useState('idle');
  const [loading, setLoading] = useState(true);
  const [programConfig, setProgramConfig] = useState(null);
  const [chainError, setChainError] = useState(null);
  const livePriceRef = useRef(0);

  // Fetch IDL once from chain — works on any program/cluster
  useEffect(() => {
    if (!connection) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const dummyWallet = {
          publicKey: PROGRAM_ID,
          signTransaction: async () => { throw new Error('read-only'); },
          signAllTransactions: async () => { throw new Error('read-only'); },
        };
        const provider = new anchor.AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
        const fetched = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
        if (!cancelled) {
          if (!fetched) {
            setChainError('No IDL on chain for ' + PROGRAM_ID.toBase58());
          } else {
            if (!fetched.address) fetched.address = PROGRAM_ID.toBase58();
            setIdl(fetched);
          }
        }
      } catch (e) {
        if (!cancelled) setChainError('IDL fetch failed: ' + (e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [connection]);

  const walletPkStr = useMemo(() => {
    const pk = toPubkey(wallet?.publicKey);
    return pk ? pk.toBase58() : null;
  }, [wallet?.publicKey]);

  const readProgram = useMemo(() => {
    if (!idl || !connection) return null;
    try {
      const dummyWallet = {
        publicKey: PROGRAM_ID,
        signTransaction: async () => { throw new Error('read-only'); },
        signAllTransactions: async () => { throw new Error('read-only'); },
      };
      const provider = new anchor.AnchorProvider(
        connection, dummyWallet,
        { commitment: 'confirmed', preflightCommitment: 'confirmed' },
      );
      return new anchor.Program(idl, provider);
    } catch (e) {
      console.error('[flipsy] readProgram init failed:', e);
      queueMicrotask(() => setChainError(`IDL load failed: ${e?.message || e}`));
      return null;
    }
  }, [connection, idl]);

  const writeProgram = useMemo(() => {
    if (!idl || !connection) return null;
    if (!walletPkStr) return null;
    if (typeof wallet?.signTransaction !== 'function') return null;
    try {
      const pk = new PublicKey(walletPkStr);
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
      queueMicrotask(() => setChainError(`Wallet init failed: ${e?.message || e}`));
      return null;
    }
  }, [connection, walletPkStr, wallet?.signTransaction, idl]);

  useEffect(() => {
    let cancelled = false;
    async function fetchPrice() {
      try {
        const res = await fetch(PRICE_URL);
        if (!res.ok) return;
        const json = await res.json();
        const p = parseFloat(json?.data?.amount);
        if (!cancelled && Number.isFinite(p) && p > 0) {
          setLivePrice(p);
          livePriceRef.current = p;
        }
      } catch (_) {}
    }
    fetchPrice();
    const i = setInterval(fetchPrice, POLL_PRICE_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  useEffect(() => {
    if (!readProgram || !connection) { setLoading(false); return; }
    let cancelled = false;

    async function fetchState() {
      try {
        const configPda = findConfigPda();
        const configInfo = await connection.getAccountInfo(configPda);
        if (!configInfo) {
          throw new Error(`Flipsy config not found at ${configPda.toBase58()}.`);
        }

        const config = await readProgram.account.config.fetch(configPda);
        const currentEpoch = bnToNumber(config.currentEpoch);
        const price = livePriceRef.current;

        const bettingDuration = bnToNumber(config.bettingDuration) || DEFAULT_BETTING_DURATION;
        const gapDuration = bnToNumber(config.gapDuration) || DEFAULT_GAP_DURATION;
        const claimForfeitDelay = bnToNumber(config.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;

        let live = null;
        if (currentEpoch > 0) {
          try {
            const r = await readProgram.account.round.fetch(findRoundPda(currentEpoch));
            live = mapRound(r, price);
            if (live.outcome !== 'unresolved') live = null;
          } catch (_) {}
        }

        const upcomingEpochs = [currentEpoch + 1, currentEpoch + 2, currentEpoch + 3];
        const liveCloseTime = live?.closeTime || Math.floor(Date.now() / 1000) + bettingDuration;
        const baseStart = liveCloseTime + gapDuration;
        const upcoming = await Promise.all(
          upcomingEpochs.map(async (e, idx) => {
            try {
              const r = await readProgram.account.round.fetch(findRoundPda(e));
              const m = mapRound(r, price);
              return m.outcome !== 'unresolved' ? null : m;
            } catch (_) {
              const start = baseStart + idx * (bettingDuration + gapDuration);
              return stubRound(e, start, bettingDuration, gapDuration, BET_LOCK_LEAD);
            }
          }),
        );

        if (live) live._claimForfeitDelay = claimForfeitDelay;

        const recentEpochs = [];
        for (let i = 1; i <= RECENT_ROUNDS_COUNT; i++) {
          if (currentEpoch - i > 0) recentEpochs.push(currentEpoch - i);
        }
        const allRecent = currentEpoch > 0 ? [currentEpoch, ...recentEpochs] : recentEpochs;
        const recents = await Promise.all(
          allRecent.map(async (e) => {
            try {
              const r = await readProgram.account.round.fetch(findRoundPda(e));
              const m = mapRound(r, price);
              return m.outcome === 'unresolved' ? null : m;
            } catch (_) { return null; }
          }),
        );

        const walletPk = toPubkey(wallet?.publicKey);
        let userBetsMap = {};
        if (walletPk) {
          try {
            const bets = await readProgram.account.bet.all([
              { memcmp: { offset: 8, bytes: walletPk.toBase58() } },
            ]);
            for (const b of bets) {
              const epoch = bnToNumber(b.account.epoch);
              const sol = lamportsToSol(b.account.amount);
              const betObj = {
                bracket: bracketStr(b.account.bracket),
                amount: solToUsd(sol, price),
                amountSol: sol,
                claimed: b.account.claimed,
                betIndex: bnToNumber(b.account.betIndex),
                pubkey: b.publicKey,
              };
              if (!userBetsMap[epoch]) userBetsMap[epoch] = [];
              userBetsMap[epoch].push(betObj);
            }
          } catch (e) { console.warn('[flipsy] user bets:', e); }
        }

        let walletBalanceUsd = 0;
        if (walletPk) {
          if (!cancelled) setBalanceStatus('loading');
          try {
            const lamports = await connection.getBalance(walletPk);
            walletBalanceUsd = solToUsd(lamportsToSol(lamports), price);
            if (!cancelled) setBalanceStatus('ok');
          } catch (_) {
            if (!cancelled) setBalanceStatus('fail');
          }
        } else {
          if (!cancelled) setBalanceStatus('idle');
        }

        if (cancelled) return;
        setLiveRound(live);
        setUpcomingRounds(upcoming.filter(Boolean));
        setRecentRounds(recents.filter(Boolean));
        setUserBets(userBetsMap);
        setBalance(walletBalanceUsd);
        setProgramConfig({
          minBet: bnToNumber(config.minBet),
          maxBet: bnToNumber(config.maxBet),
          feeBps: bnToNumber(config.feeBps),
          bettingDuration, gapDuration,
          betLockLead: BET_LOCK_LEAD,
          maxFutureRounds: bnToNumber(config.maxFutureRounds),
          claimForfeitDelay,
          paused: config.paused,
        });
        setChainError(null);
      } catch (e) {
        console.error('[flipsy] state fetch error:', e);
        if (!cancelled) setChainError(e?.message || String(e) || 'Failed to load on-chain state');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchState();
    const i = setInterval(fetchState, POLL_CHAIN_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, [readProgram, walletPkStr, connection, wallet]);

  // placeBet(epoch, bracket, usdAmount) — bracket is one of BRACKETS.
  const placeBet = useCallback(async (epoch, bracket, usdAmount) => {
    if (!writeProgram) throw new Error('Connect your wallet first');
    if (!BRACKETS.includes(bracket)) throw new Error('Invalid bracket');
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
        .placeBet(new anchor.BN(epoch), new anchor.BN(betIndex), new anchor.BN(lamports), bracketToVariant(bracket))
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
    } catch (e) { console.warn('[flipsy] round fetch:', e); }

    const configPda = findConfigPda();
    let authorityPk;
    try {
      const cfg = await writeProgram.account.config.fetch(configPda);
      authorityPk = toPubkey(cfg.authority || cfg.admin);
      claimForfeitDelay = bnToNumber(cfg.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;
    } catch (e) { throw new Error('Failed to load program config'); }
    if (!authorityPk) throw new Error('Program authority missing');

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
            vault: vaultPda, authority: authorityPk, user: walletPk,
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
    livePrice, liveRound, upcomingRounds, recentRounds, userBets, balance,
    balanceStatus,
    placeBet, claim, loading, programConfig, chainError,
    BRACKETS,
  };
}
