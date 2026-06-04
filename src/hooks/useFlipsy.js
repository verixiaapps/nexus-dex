import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../idl/flipsy.json';

// ============================================================
// PROGRAM CONFIG
// ============================================================
const PROGRAM_ID = new PublicKey('71bEAUToad7j8k8As9LwsGWBYTLxVJoP2SBNB3S3RLHs');
const SUPER_ADMIN = new PublicKey('GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA');
const PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';

const POLL_PRICE_MS = 2_500;
const POLL_CHAIN_MS = 5_000;

const LAMPORTS_PER_SOL = 1_000_000_000;
const PRICE_SCALE = 100_000_000; // lockPrice is i64 with 8 decimal places (e.g. 7248000000 = $72.48)

const BETTING_DURATION = 360; // seconds, matches lib.rs
const GAP_DURATION = 30;

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

// Map an on-chain Round to the shape the UI expects, converting lamports → USD via livePrice.
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

// A round whose PDA doesn't exist yet (no bets placed). Built from calculated start time.
function stubRound(epoch, expectedStartTime) {
  return {
    epoch,
    lockPrice: 0,
    closePrice: 0,
    startTime: expectedStartTime,
    lockTime: expectedStartTime + BETTING_DURATION,
    closeTime: expectedStartTime + BETTING_DURATION,
    nextStartTime: expectedStartTime + BETTING_DURATION + GAP_DURATION,
    headsPool: 0,
    tailsPool: 0,
    headsPoolSol: 0,
    tailsPoolSol: 0,
    betCount: 0,
    outcome: 'unresolved',
    resolvedAt: 0,
    swept: false,
  };
}

// ============================================================
// HOOK
// ============================================================
export function useFlipsy(wallet) {
  const { connection } = useConnection();
  const [livePrice, setLivePrice] = useState(0);
  const [liveRound, setLiveRound] = useState(null);
  const [upcomingRounds, setUpcomingRounds] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const [userBets, setUserBets] = useState({});
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const livePriceRef = useRef(0);

  // Build Anchor program when wallet ready
  const program = useMemo(() => {
    if (!wallet?.publicKey || !wallet?.signTransaction) return null;
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed', preflightCommitment: 'confirmed' },
    );
    return new anchor.Program(idl, PROGRAM_ID, provider);
  }, [connection, wallet?.publicKey, wallet?.signTransaction]);

  // -------- POLL COINBASE for live SOL/USD price --------
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
      } catch (_) {
        // ignore network blips
      }
    }
    fetchPrice();
    const i = setInterval(fetchPrice, POLL_PRICE_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  // -------- POLL CHAIN STATE (config, rounds, user bets, balance) --------
  useEffect(() => {
    if (!program) return;
    let cancelled = false;

    async function fetchState() {
      try {
        const configPda = findConfigPda();
        const config = await program.account.config.fetch(configPda);
        const currentEpoch = bnToNumber(config.currentEpoch);
        const price = livePriceRef.current; // capture once per pass for consistency

        // EPOCH MODEL (matches lib.rs):
        //   currentEpoch = most recently started round.
        //   - LIVE (locked, awaiting close): epoch = currentEpoch
        //   - NEXT (open for bets): epoch = currentEpoch + 1
        //   - LATER: currentEpoch + 2, +3
        //   - RECENT (resolved, past): currentEpoch - 1, -2, -3

        // ---- LIVE round ----
        let live = null;
        if (currentEpoch > 0) {
          try {
            const r = await program.account.round.fetch(findRoundPda(currentEpoch));
            live = mapRound(r, price);
            // If already resolved on chain, move to recents instead
            if (live.outcome !== 'unresolved') live = null;
          } catch (_) { /* not initialised yet */ }
        }

        // ---- UPCOMING rounds (3 ahead) ----
        const upcomingEpochs = [currentEpoch + 1, currentEpoch + 2, currentEpoch + 3];
        const liveCloseTime = live?.closeTime || Math.floor(Date.now() / 1000) + BETTING_DURATION;
        const baseStart = liveCloseTime + GAP_DURATION;
        const upcoming = await Promise.all(
          upcomingEpochs.map(async (e, idx) => {
            try {
              const r = await program.account.round.fetch(findRoundPda(e));
              const mapped = mapRound(r, price);
              // Only show as upcoming if not resolved
              if (mapped.outcome !== 'unresolved') return null;
              return mapped;
            } catch (_) {
              // Round PDA doesn't exist yet — show stub with calculated start time
              const start = baseStart + idx * (BETTING_DURATION + GAP_DURATION);
              return stubRound(e, start);
            }
          }),
        );

        // ---- RECENT rounds (3 back, only resolved) ----
        const recentEpochs = [];
        for (let i = 1; i <= 3; i++) if (currentEpoch - i > 0) recentEpochs.push(currentEpoch - i);
        // Also surface the currentEpoch round if it resolved (rare race window)
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

        // ---- USER BETS (filter by user pubkey at byte offset 8) ----
        let userBetsMap = {};
        if (wallet?.publicKey) {
          try {
            const bets = await program.account.bet.all([
              { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
            ]);
            for (const b of bets) {
              const epoch = bnToNumber(b.account.epoch);
              const sol = lamportsToSol(b.account.amount);
              userBetsMap[epoch] = {
                side: 'heads' in b.account.side ? 'heads' : 'tails',
                amount: solToUsd(sol, price),
                amountSol: sol,
                claimed: b.account.claimed,
                betIndex: bnToNumber(b.account.betIndex),
                pubkey: b.publicKey,
              };
            }
          } catch (e) {
            console.warn('Flipsy: failed to fetch user bets', e);
          }
        }

        // ---- WALLET BALANCE ----
        let walletBalanceUsd = 0;
        if (wallet?.publicKey) {
          try {
            const lamports = await connection.getBalance(wallet.publicKey);
            walletBalanceUsd = solToUsd(lamportsToSol(lamports), price);
          } catch (_) { /* ignore */ }
        }

        if (cancelled) return;
        setLiveRound(live);
        setUpcomingRounds(upcoming.filter(Boolean));
        setRecentRounds(recents.filter(Boolean));
        setUserBets(userBetsMap);
        setBalance(walletBalanceUsd);
        setLoading(false);
      } catch (e) {
        console.error('Flipsy state fetch error:', e);
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

    // Convert USD → SOL → lamports
    const solAmount = usdAmount / price;
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

    // Figure out next bet_index for (user, epoch). Each new bet for the same user+epoch needs a unique index.
    const existing = userBets[epoch];
    const betIndex = existing ? existing.betIndex + 1 : 0;

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
      // Surface a friendlier error
      const msg = e?.error?.errorMessage || e?.message || 'Bet failed';
      throw new Error(msg);
    }
  }, [program, wallet?.publicKey, userBets]);

  // -------- CLAIM --------
  const claim = useCallback(async (epoch) => {
    if (!program || !wallet?.publicKey) throw new Error('Connect your wallet first');
    const userBet = userBets[epoch];
    if (!userBet) throw new Error('No bet found for that round');

    const configPda = findConfigPda();
    const roundPda = findRoundPda(epoch);
    const vaultPda = findVaultPda(epoch);
    const betPda = findBetPda(epoch, wallet.publicKey, userBet.betIndex);

    try {
      const tx = await program.methods
        .claim()
        .accounts({
          config: configPda,
          round: roundPda,
          bet: betPda,
          vault: vaultPda,
          superAdmin: SUPER_ADMIN,
          user: wallet.publicKey,
        })
        .rpc();
      return tx;
    } catch (e) {
      const msg = e?.error?.errorMessage || e?.message || 'Claim failed';
      throw new Error(msg);
    }
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
  };
}
 