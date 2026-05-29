import { useState, useEffect, useCallback, useMemo } from 'react';
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import flipsyIdl from '../idl/flipsy.json';

// Env config — override via REACT_APP_* env vars
const NETWORK = process.env.REACT_APP_FLIPSY_NETWORK || 'devnet';
const RPC_URL = process.env.REACT_APP_FLIPSY_RPC ||
  (NETWORK === 'mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');
const PROGRAM_ID = new PublicKey(
  process.env.REACT_APP_FLIPSY_PROGRAM_ID || 'Fpsy1111111111111111111111111111111111111111'
);
const USDC_MINT = new PublicKey( 
  process.env.REACT_APP_FLIPSY_USDC ||
    (NETWORK === 'mainnet'
      ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
);

const epochToBytes = (n) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
};

const findConfigPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];

const findRoundPda = (epoch) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('round'), epochToBytes(epoch)],
    PROGRAM_ID
  )[0];

const findVaultPda = (epoch) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), epochToBytes(epoch)],
    PROGRAM_ID
  )[0];

const findBetPda = (epoch, user) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('bet'), epochToBytes(epoch), user.toBuffer()],
    PROGRAM_ID
  )[0];

const outcomeKey = (o) => {
  if (!o) return 'unresolved';
  if ('unresolved' in o) return 'unresolved';
  if ('heads' in o) return 'heads';
  if ('tails' in o) return 'tails';
  if ('tie' in o) return 'tie';
  if ('noWinners' in o) return 'noWinners';
  return 'unresolved';
};

export function useFlipsy(wallet) {
  const [connection] = useState(() => new Connection(RPC_URL, 'confirmed'));
  const [config, setConfig] = useState(null);
  const [liveRound, setLiveRound] = useState(null);
  const [upcomingRounds, setUpcomingRounds] = useState([]);
  const [recentRounds, setRecentRounds] = useState([]);
  const [userBets, setUserBets] = useState({});
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const provider = useMemo(() => {
    if (!wallet?.publicKey) return null;
    return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (!provider) return null;
    try {
      return new Program(flipsyIdl, provider);
    } catch (e) {
      console.error('Failed to load Flipsy program:', e);
      return null;
    }
  }, [provider]);

  const readOnlyProgram = useMemo(() => {
    // Read-only program for users not connected yet
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    };
    const ro = new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
    try {
      return new Program(flipsyIdl, ro);
    } catch (e) {
      return null;
    }
  }, [connection]);

  const activeProgram = program || readOnlyProgram;

  const fetchAll = useCallback(async () => {
    if (!activeProgram) return;
    try {
      setLoading(true);
      setError(null);

      const configPda = findConfigPda();
      const cfg = await activeProgram.account.config.fetch(configPda);
      setConfig(cfg);

      const currentEpoch = cfg.currentEpoch.toNumber();

      // Fetch live round
      if (currentEpoch > 0) {
        try {
          const round = await activeProgram.account.round.fetch(findRoundPda(currentEpoch));
          setLiveRound({ epoch: currentEpoch, ...round });
        } catch {
          setLiveRound(null);
        }
      }

      // Fetch upcoming rounds (next 3 epochs)
      const upcoming = [];
      for (let i = 1; i <= 3; i++) {
        const ep = currentEpoch + i;
        try {
          const round = await activeProgram.account.round.fetch(findRoundPda(ep));
          upcoming.push({ epoch: ep, ...round });
        } catch {
          // Round doesn't exist yet — show placeholder
          upcoming.push({ epoch: ep, headsPool: new BN(0), tailsPool: new BN(0), placeholder: true });
        }
      }
      setUpcomingRounds(upcoming);

      // Fetch recent (last 5)
      const recent = [];
      for (let i = 1; i <= 5; i++) {
        const ep = currentEpoch - i;
        if (ep < 1) break;
        try {
          const round = await activeProgram.account.round.fetch(findRoundPda(ep));
          recent.push({ epoch: ep, ...round });
        } catch {
          // skip missing
        }
      }
      setRecentRounds(recent);

      // Fetch user's bets and USDC balance
      if (wallet?.publicKey) {
        const bets = {};
        const epochsToCheck = [currentEpoch, currentEpoch + 1, currentEpoch + 2, currentEpoch + 3];
        for (const ep of epochsToCheck) {
          if (ep < 1) continue;
          try {
            const bet = await activeProgram.account.bet.fetch(findBetPda(ep, wallet.publicKey));
            bets[ep] = {
              side: 'heads' in bet.side ? 'heads' : 'tails',
              amount: bet.amount.toNumber() / 1e6,
              claimed: bet.claimed,
            };
          } catch {
            // no bet, skip
          }
        }
        setUserBets(bets);

        try {
          const userAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
          const account = await getAccount(connection, userAta);
          setBalance(Number(account.amount) / 1e6);
        } catch {
          setBalance(0);
        }
      } else {
        setUserBets({});
        setBalance(0);
      }
    } catch (e) {
      console.error('Flipsy fetch error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeProgram, wallet?.publicKey, connection]);

  // Initial + poll every 4s
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 4000);
    return () => clearInterval(i);
  }, [fetchAll]);

  // Place bet
  const placeBet = useCallback(
    async (epoch, side, amountUsd) => {
      if (!program || !wallet?.publicKey || !config) throw new Error('Wallet not connected');
      const amountLamports = new BN(Math.floor(amountUsd * 1e6));
      const userAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);

      const tx = await program.methods
        .placeBet(amountLamports, side === 'heads' ? { heads: {} } : { tails: {} })
        .accounts({
          config: findConfigPda(),
          round: findRoundPda(epoch),
          bet: findBetPda(epoch, wallet.publicKey),
          vault: findVaultPda(epoch),
          userUsdc: userAta,
          treasuryUsdc: config.treasury,
          user: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await fetchAll();
      return tx;
    },
    [program, wallet?.publicKey, config, fetchAll]
  );

  // Claim winnings
  const claim = useCallback(
    async (epoch) => {
      if (!program || !wallet?.publicKey || !config) throw new Error('Wallet not connected');
      const userAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
      const tx = await program.methods
        .claim()
        .accounts({
          config: findConfigPda(),
          round: findRoundPda(epoch),
          bet: findBetPda(epoch, wallet.publicKey),
          vault: findVaultPda(epoch),
          userUsdc: userAta,
          treasuryUsdc: config.treasury,
          user: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      await fetchAll();
      return tx;
    },
    [program, wallet?.publicKey, config, fetchAll]
  );

  // Helper: convert raw round to UI shape
  const toUiRound = useCallback((r) => {
    if (!r) return null;
    return {
      epoch: r.epoch,
      lockPrice: r.lockPrice ? r.lockPrice.toNumber() / 1e8 : 0,
      closePrice: r.closePrice ? r.closePrice.toNumber() / 1e8 : 0,
      headsPool: r.headsPool ? r.headsPool.toNumber() / 1e6 : 0,
      tailsPool: r.tailsPool ? r.tailsPool.toNumber() / 1e6 : 0,
      lockTime: r.lockTime ? r.lockTime.toNumber() : 0,
      closeTime: r.closeTime ? r.closeTime.toNumber() : 0,
      outcome: outcomeKey(r.outcome),
      placeholder: r.placeholder || false,
    };
  }, []);

  return {
    config,
    liveRound: toUiRound(liveRound),
    upcomingRounds: upcomingRounds.map(toUiRound),
    recentRounds: recentRounds.map(toUiRound),
    userBets,
    balance,
    loading,
    error,
    placeBet,
    claim,
    refresh: fetchAll,
  };
}
