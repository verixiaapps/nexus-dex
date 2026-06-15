import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../idl/flipsy.json';

// ============================================================
// CONFIG
// ============================================================
const PROGRAM_ID = new PublicKey('71bEAUToad7j8k8As9LwsGWBYTLxVJoP2SBNB3S3RLHs');

// Devnet RPC. For mainnet, swap to your Helius URL:
//   https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
const FLIPSY_RPC = 'https://api.devnet.solana.com';

const PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';

const POLL_PRICE_MS = 2_500;
const POLL_CHAIN_MS = 5_000;

const LAMPORTS_PER_SOL = 1_000_000_000;
const PRICE_SCALE = 1e8;

// Frontend defaults — auto-overridden by on-chain config once loaded.
const DEFAULT_BETTING_DURATION = 900;
const DEFAULT_GAP_DURATION = 30;
const DEFAULT_CLAIM_FORFEIT_DELAY = 21_600;

const RECENT_ROUNDS_COUNT = 10;

// ============================================================
// PDA HELPERS
// ============================================================
const u64Buf = (n) => new anchor.BN(n).toArrayLike(Buffer, 'le', 8);

const findConfigPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];

const findRoundPda = (epoch) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('round'), u64Buf(epoch)],
    PROGRAM_ID,
  )[0];

const findVaultPda = (epoch) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), u64Buf(epoch)],
    PROGRAM_ID,
  )[0];

const findBetPda = (epoch, user, betIndex) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('bet'), u64Buf(epoch), user.toBuffer(), u64Buf(betIndex)],
    PROGRAM_ID,
  )[0];

// ============================================================
// CONVERSION HELPERS
// ============================================================
const bnToNumber = (bn) => (typeof bn === 'object' && bn.toNumber) ? bn.toNumber() : Number(bn);
const lamportsToSol = (l) => bnToNumber(l) / LAMPORTS_PER_SOL;
const chainPriceToUsd = (p) => bnToNumber(p) / PRICE_SCALE;
const solToUsd = (sol, pricePerSol) => sol * (pricePerSol || 0);

function outcomeStr(outcome) {
  if (!outcome) return 'unresolved';
  if ('heads' in outcome) return 'heads';
  if ('tails' in outcome) return 'tails';
  if ('tie' in outcome) return 'tie';
  if ('allLost' in outcome) return 'allLost';
  return 'unresolved';
}

function sideToVariant(side) {
  return side === 'heads' ? { heads: {} } : { tails: {} };
}

function mapRound(r, livePrice) {
  const headsSol = lamportsToSol(r.headsPool);
  const tailsSol = lamportsToSol(r.tailsPool);
  const lockPrice = chainPriceToUsd(r.lockPrice);
  const closePrice = chainPriceToUsd(r.closePrice);

  return {
    epoch: bnToNumber(r.epoch),
    lockPrice,
    closePrice,
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
    epoch,
    lockPrice: 0, closePrice: 0,
    startTime: expectedStartTime,
    lockTime: expectedStartTime + bettingDuration,
    closeTime: expectedStartTime + bettingDuration,
    nextStartTime: expectedStartTime + bettingDuration + gapDuration,
    headsPool: 0, tailsPool: 0,
    headsPoolSol: 0, tailsPoolSol: 0,
    betCount: 0, outcome: 'unresolved',
    resolvedAt: 0, swept: false,
  };
}

// ============================================================
// HOOK
// ============================================================
export function useFlipsy(wallet) {
  const connection = useMemo(
    () => new Connection(FLIPSY_RPC, 'confirmed'),
    [],
  );

  const [livePrice, setLivePrice] = useState(0);
  const [liveRound, setLiveRound] = useState(null);
  const [upcomingRounds, setUpcomingRounds] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const [userBets, setUserBets] = useState({});
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [programConfig, setProgramConfig] = useState(null);
  const livePriceRef = useRef(0);

  const program = useMemo(() => {
    if (!wallet?.publicKey || !wallet?.signTransaction) return null;
    const provider = new anchor.AnchorProvider(
      connection, wallet,
      { commitment: 'confirmed', preflightCommitment: 'confirmed' },
    );
    // anchor 0.30+ reads the programId from a top-level `address` field on
    // the IDL — the legacy `(idl, programId, provider)` constructor was
    // removed. Inject the address here so we don't have to edit the JSON.
    const idlWithAddress = { ...idl, address: PROGRAM_ID.toBase58() };
    return new anchor.Program(idlWithAddress, provider);
  }, [connection, wallet?.publicKey, wallet?.signTransaction]);

  // -------- POLL COINBASE --------
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

  // -------- POLL CHAIN STATE --------
  useEffect(() => {
    if (!program) return;
    let cancelled = false;

    async function fetchState() {
      try {
        const configPda = findConfigPda();
        const config = await program.account.config.fetch(configPda);
        const currentEpoch = bnToNumber(config.currentEpoch);
        const price = livePriceRef.current;

        const bettingDuration = bnToNumber(config.bettingDuration) || DEFAULT_BETTING_DURATION;
        const gapDuration = bnToNumber(config.gapDuration) || DEFAULT_GAP_DURATION;
        const claimForfeitDelay = bnToNumber(config.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;

        let live = null;
        if (currentEpoch > 0) {
          try {
            const r = await program.account.round.fetch(findRoundPda(currentEpoch));
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
              const r = await program.account.round.fetch(findRoundPda(e));
              const mapped = mapRound(r, price);
              if (mapped.outcome !== 'unresolved') return null;
              return mapped;
            } catch (_) {
              const start = baseStart + idx * (bettingDuration + gapDuration);
              return stubRound(e, start, bettingDuration, gapDuration);
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
              const r = await program.account.round.fetch(findRoundPda(e));
              const m = mapRound(r, price);
              return m.outcome === 'unresolved' ? null : m;
            } catch (_) { return null; }
          }),
        );

        let userBetsMap = {};
        if (wallet?.publicKey) {
          try {
            const bets = await program.account.bet.all([
              { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
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
          } catch (e) {
            console.warn('[flipsy] failed to fetch user bets:', e);
          }
        }

        let walletBalanceUsd = 0;
        if (wallet?.publicKey) {
          try {
            const lamports = await connection.getBalance(wallet.publicKey);
            walletBalanceUsd = solToUsd(lamportsToSol(lamports), price);
          } catch (_) {}
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
          bettingDuration,
          gapDuration,
          maxFutureRounds: bnToNumber(config.maxFutureRounds),
          claimForfeitDelay,
          paused: config.paused,
        });
        setLoading(false);
      } catch (e) {
        console.error('[flipsy] state fetch error:', e);
      }
    }

    fetchState();
    const i = setInterval(fetchState, POLL_CHAIN_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, [program, wallet?.publicKey, connection]);

  // -------- PLACE BET --------
  const placeBet = useCallback(async (epoch, side, usdAmount) => {
    if (!program || !wallet?.publicKey) throw new Error('Connect your wallet first');
    const price = livePriceRef.current;
    if (!price) throw new Error('Price not loaded yet, try again in a sec');

    const solAmount = usdAmount / price;
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

    const existingBets = userBets[epoch] || [];
    const betIndex = existingBets.length > 0
      ? Math.max(...existingBets.map(b => b.betIndex)) + 1
      : 0;

    const configPda = findConfigPda();
    const roundPda = findRoundPda(epoch);
    const vaultPda = findVaultPda(epoch);
    const betPda = findBetPda(epoch, wallet.publicKey, betIndex);

    try {
      const tx = await program.methods
        .placeBet(
          new anchor.BN(epoch),
          new anchor.BN(betIndex),
          new anchor.BN(lamports),
          sideToVariant(side),
        )
        .accounts({
          config: configPda,
          round: roundPda,
          vault: vaultPda,
          bet: betPda,
          user: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return tx;
    } catch (e) {
      const msg = e?.error?.errorMessage || e?.message || 'Bet failed';
      console.error('[flipsy] placeBet error:', e);
      throw new Error(msg);
    }
  }, [program, wallet?.publicKey, userBets]);

  // -------- CLAIM --------
  const claim = useCallback(async (epoch) => {
    if (!program || !wallet?.publicKey) throw new Error('Connect your wallet first');

    const betsForEpoch = userBets[epoch] || [];
    const unclaimedBets = betsForEpoch.filter(b => !b.claimed);
    if (unclaimedBets.length === 0) throw new Error('No claimable bets for that round');

    const roundPda = findRoundPda(epoch);
    let resolvedAt = 0;
    let claimForfeitDelay = DEFAULT_CLAIM_FORFEIT_DELAY;
    try {
      const roundData = await program.account.round.fetch(roundPda);
      resolvedAt = bnToNumber(roundData.resolvedAt);
    } catch (e) {
      console.warn('[flipsy] could not fetch round for deadline check:', e);
    }

    const configPda = findConfigPda();
    let authority;
    try {
      const config = await program.account.config.fetch(configPda);
      authority = config.authority;
      claimForfeitDelay = bnToNumber(config.claimForfeitDelay) || DEFAULT_CLAIM_FORFEIT_DELAY;
    } catch (e) {
      throw new Error('Failed to load program config');
    }

    const nowTs = Math.floor(Date.now() / 1000);
    if (resolvedAt > 0 && nowTs > resolvedAt + claimForfeitDelay) {
      throw new Error('Claim window expired — winnings forfeited');
    }

    const vaultPda = findVaultPda(epoch);

    let lastTx = null;
    for (const bet of unclaimedBets) {
      const betPda = findBetPda(epoch, wallet.publicKey, bet.betIndex);
      try {
        lastTx = await program.methods
          .claim()
          .accounts({
            config: configPda,
            round: roundPda,
            bet: betPda,
            vault: vaultPda,
            authority,
            user: wallet.publicKey,
          })
          .rpc();
      } catch (e) {
        const msg = e?.error?.errorMessage || e?.message || 'Claim failed';
        console.error('[flipsy] claim error:', e);
        throw new Error(msg);
      }
    }
    return lastTx;
  }, [program, wallet?.publicKey, userBets]);

  return {
    livePrice,
    liveRound,
    upcomingRounds,
    recentRounds,
    userBets,
    balance,
    placeBet,
    claim,
    loading,
    programConfig,
  };
}
