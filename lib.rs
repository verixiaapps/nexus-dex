use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke;

// ============================================================
// IMPORTANT: After Solana Playground builds, it generates a new
// program keypair and ID. Copy that ID and paste below.
// Same source file works for devnet and mainnet.
// ============================================================
declare_id!("REPLACE_WITH_PROGRAM_ID");

// ============================================================
// CONSTANTS — fixed only because they affect account sizes / payouts hard-coded math.
// ALL TUNABLE PARAMETERS LIVE IN THE CONFIG ACCOUNT (see ProgramParams).
// ============================================================
const BPS_DIVISOR: u64 = 10_000;

// Bounds for safety — authority can set any value within these guardrails.
const MAX_FEE_BPS: u64 = 9_000;              // 90% — prevents fat-finger 100%+
const MIN_BETTING_DURATION: i64 = 60;        // 1 minute minimum
const MAX_BETTING_DURATION: i64 = 86_400;    // 24 hours maximum
const MAX_GAP_DURATION: i64 = 3_600;         // 1 hour gap max
const MAX_FUTURE_ROUNDS_LIMIT: u64 = 100;
const MIN_CLAIM_DELAY: i64 = 600;            // 10 min minimum claim window
const MAX_CLAIM_DELAY: i64 = 2_592_000;      // 30 days max
const MIN_REFUND_DELAY: i64 = 3_600;         // 1h min before force refund
const MAX_REFUND_DELAY: i64 = 2_592_000;

#[program]
pub mod flipsy {
    use super::*;

    /// Initialize the program. Signer becomes the authority.
    /// Sets all initial parameters in one shot.
    pub fn initialize(
        ctx: Context<Initialize>,
        cranker: Pubkey,
        min_bet: u64,
        max_bet: u64,
        fee_bps: u64,
        betting_duration: i64,
        gap_duration: i64,
        max_future_rounds: u64,
        claim_forfeit_delay: i64,
        force_refund_delay: i64,
    ) -> Result<()> {
        require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
        validate_program_params(
            fee_bps,
            betting_duration,
            gap_duration,
            max_future_rounds,
            claim_forfeit_delay,
            force_refund_delay,
        )?;

        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.payer.key();
        c.cranker = cranker;
        c.current_epoch = 0;
        c.paused = false;
        c.min_bet = min_bet;
        c.max_bet = max_bet;
        c.fee_bps = fee_bps;
        c.betting_duration = betting_duration;
        c.gap_duration = gap_duration;
        c.max_future_rounds = max_future_rounds;
        c.claim_forfeit_delay = claim_forfeit_delay;
        c.force_refund_delay = force_refund_delay;
        c.bump = ctx.bumps.config;
        emit!(ConfigInitialized { authority: c.authority, cranker });
        Ok(())
    }

    /// Transfer authority to a new wallet. Only callable by current authority.
    pub fn set_authority(ctx: Context<AuthorityOnly>, new_authority: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        let old = c.authority;
        c.authority = new_authority;
        emit!(AuthorityChanged { old, new_authority });
        Ok(())
    }

    /// Update the cranker wallet.
    pub fn set_cranker(ctx: Context<AuthorityOnly>, new_cranker: Pubkey) -> Result<()> {
        ctx.accounts.config.cranker = new_cranker;
        Ok(())
    }

    /// Set min/max bet in lamports.
    pub fn set_bet_limits(
        ctx: Context<AuthorityOnly>,
        min_bet: u64,
        max_bet: u64,
    ) -> Result<()> {
        require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
        let c = &mut ctx.accounts.config;
        c.min_bet = min_bet;
        c.max_bet = max_bet;
        emit!(BetLimitsChanged { min_bet, max_bet });
        Ok(())
    }

    /// Update the full set of tunable program parameters.
    /// fee_bps: win fee in basis points (2500 = 25%)
    /// betting_duration: how long each round lasts (seconds)
    /// gap_duration: gap between rounds (seconds)
    /// max_future_rounds: how many rounds ahead users can bet
    /// claim_forfeit_delay: claim window (seconds)
    /// force_refund_delay: delay before authority can force-refund a stuck round
    pub fn set_program_params(
        ctx: Context<AuthorityOnly>,
        fee_bps: u64,
        betting_duration: i64,
        gap_duration: i64,
        max_future_rounds: u64,
        claim_forfeit_delay: i64,
        force_refund_delay: i64,
    ) -> Result<()> {
        validate_program_params(
            fee_bps,
            betting_duration,
            gap_duration,
            max_future_rounds,
            claim_forfeit_delay,
            force_refund_delay,
        )?;

        let c = &mut ctx.accounts.config;
        c.fee_bps = fee_bps;
        c.betting_duration = betting_duration;
        c.gap_duration = gap_duration;
        c.max_future_rounds = max_future_rounds;
        c.claim_forfeit_delay = claim_forfeit_delay;
        c.force_refund_delay = force_refund_delay;
        emit!(ProgramParamsChanged {
            fee_bps,
            betting_duration,
            gap_duration,
            max_future_rounds,
            claim_forfeit_delay,
            force_refund_delay,
        });
        Ok(())
    }

    /// Pause or unpause the program.
    pub fn set_paused(ctx: Context<AuthorityOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseToggled { paused });
        Ok(())
    }

    /// Force-refund a stuck round.
    pub fn force_refund(ctx: Context<AuthorityOnlyRound>) -> Result<()> {
        let clock = Clock::get()?;
        let force_refund_delay = ctx.accounts.config.force_refund_delay;
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
        require!(round.close_time > 0, FlipsyError::RoundNotStarted);
        require!(
            clock.unix_timestamp >= round.close_time + force_refund_delay,
            FlipsyError::TooEarlyForRefund
        );
        round.outcome = Outcome::Tie;
        round.resolved_at = clock.unix_timestamp;
        emit!(RoundForceRefunded { epoch: round.epoch });
        Ok(())
    }

    /// Sweep unclaimed winnings to authority after the claim window expires.
    pub fn sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
        let clock = Clock::get()?;
        let claim_forfeit_delay = ctx.accounts.config.claim_forfeit_delay;
        let round = &mut ctx.accounts.round;
        require!(round.resolved_at > 0, FlipsyError::NotResolved);
        require!(
            clock.unix_timestamp >= round.resolved_at + claim_forfeit_delay,
            FlipsyError::TooEarlyForSweep
        );
        require!(!round.swept, FlipsyError::AlreadySwept);

        let vault_info = ctx.accounts.vault.to_account_info();
        let recipient = ctx.accounts.authority.to_account_info();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(vault_info.data_len());
        let balance = vault_info.lamports();
        let mut amount = 0u64;
        if balance > min_balance {
            amount = balance - min_balance;
            **vault_info.try_borrow_mut_lamports()? -= amount;
            **recipient.try_borrow_mut_lamports()? += amount;
        }
        round.swept = true;
        emit!(UnclaimedSwept { epoch: round.epoch, amount });
        Ok(())
    }

    /// Emergency sweep — authority can pull funds anytime, bypasses delay.
    pub fn super_sweep(ctx: Context<SweepUnclaimed>) -> Result<()> {
        let vault_info = ctx.accounts.vault.to_account_info();
        let recipient = ctx.accounts.authority.to_account_info();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(vault_info.data_len());
        let balance = vault_info.lamports();
        if balance > min_balance {
            let amount = balance - min_balance;
            **vault_info.try_borrow_mut_lamports()? -= amount;
            **recipient.try_borrow_mut_lamports()? += amount;
            emit!(SuperSwept { epoch: ctx.accounts.round.epoch, amount });
        }
        let round = &mut ctx.accounts.round;
        round.swept = true;
        Ok(())
    }

    /// Start a new round. Only callable by cranker or authority.
    pub fn start_round(ctx: Context<StartRound>, lock_price: i64) -> Result<()> {
        require!(!ctx.accounts.config.paused, FlipsyError::Paused);
        require!(lock_price > 0, FlipsyError::BadPrice);
        let clock = Clock::get()?;
        let betting_duration = ctx.accounts.config.betting_duration;
        let gap_duration = ctx.accounts.config.gap_duration;

        let config = &mut ctx.accounts.config;
        config.current_epoch = config
            .current_epoch
            .checked_add(1)
            .ok_or(FlipsyError::MathOverflow)?;

        let round = &mut ctx.accounts.round;
        round.epoch = config.current_epoch;
        round.start_time = clock.unix_timestamp;
        round.lock_time = clock.unix_timestamp + betting_duration;
        round.close_time = clock.unix_timestamp + betting_duration;
        round.next_start_time = round.close_time + gap_duration;
        round.lock_price = lock_price;
        round.close_price = 0;
        round.outcome = Outcome::Unresolved;
        round.resolved_at = 0;
        round.swept = false;
        if round.bump == 0 {
            round.bump = ctx.bumps.round;
        }
        emit!(RoundStarted { epoch: round.epoch, lock_price });
        Ok(())
    }

    /// End a round with the close price.
    pub fn end_round(ctx: Context<EndRound>, close_price: i64) -> Result<()> {
        require!(close_price > 0, FlipsyError::BadPrice);
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
        require!(round.close_time > 0, FlipsyError::RoundNotStarted);
        require!(
            clock.unix_timestamp >= round.close_time,
            FlipsyError::RoundNotClosed
        );
        round.close_price = close_price;
        round.resolved_at = clock.unix_timestamp;
        round.outcome = if close_price == round.lock_price {
            Outcome::Tie
        } else if close_price > round.lock_price {
            if round.heads_pool > 0 { Outcome::Heads } else { Outcome::AllLost }
        } else if round.tails_pool > 0 {
            Outcome::Tails
        } else {
            Outcome::AllLost
        };

        if round.outcome == Outcome::AllLost {
            let total = round
                .heads_pool
                .checked_add(round.tails_pool)
                .ok_or(FlipsyError::MathOverflow)?;
            if total > 0 {
                let vault_info = ctx.accounts.vault.to_account_info();
                let recipient = ctx.accounts.authority.to_account_info();
                **vault_info.try_borrow_mut_lamports()? -= total;
                **recipient.try_borrow_mut_lamports()? += total;
            }
            round.swept = true;
        }

        emit!(RoundEnded {
            epoch: round.epoch,
            close_price,
            outcome: round.outcome,
        });
        Ok(())
    }

    /// Place a bet on a round.
    /// Allows betting on the current live round OR any future round up to
    /// config.max_future_rounds ahead.
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        target_epoch: u64,
        bet_index: u64,
        amount: u64,
        side: Side,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, FlipsyError::Paused);
        require!(amount >= config.min_bet, FlipsyError::BelowMin);
        require!(amount <= config.max_bet, FlipsyError::AboveMax);

        let min_epoch = config.current_epoch.max(1);
        let max_epoch = config
            .current_epoch
            .checked_add(config.max_future_rounds)
            .ok_or(FlipsyError::MathOverflow)?;
        require!(
            target_epoch >= min_epoch && target_epoch <= max_epoch,
            FlipsyError::RoundOutOfRange
        );

        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        if round.lock_time > 0 {
            require!(
                clock.unix_timestamp < round.lock_time,
                FlipsyError::RoundLocked
            );
        }

        if round.epoch == 0 {
            round.epoch = target_epoch;
            round.bump = ctx.bumps.round;
        }

        let ix = system_instruction::transfer(
            ctx.accounts.user.key,
            &ctx.accounts.vault.key(),
            amount,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.user = ctx.accounts.user.key();
        bet.epoch = target_epoch;
        bet.bet_index = bet_index;
        bet.amount = amount;
        bet.side = side;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        match side {
            Side::Heads => {
                round.heads_pool = round
                    .heads_pool
                    .checked_add(amount)
                    .ok_or(FlipsyError::MathOverflow)?;
            }
            Side::Tails => {
                round.tails_pool = round
                    .tails_pool
                    .checked_add(amount)
                    .ok_or(FlipsyError::MathOverflow)?;
            }
        }
        round.bet_count = round
            .bet_count
            .checked_add(1)
            .ok_or(FlipsyError::MathOverflow)?;

        emit!(BetPlaced {
            epoch: target_epoch,
            user: bet.user,
            bet_index,
            amount,
            side,
        });
        Ok(())
    }

    /// Claim a bet's payout. Must be within the claim window.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let clock = Clock::get()?;
        let fee_bps = ctx.accounts.config.fee_bps;
        let claim_forfeit_delay = ctx.accounts.config.claim_forfeit_delay;
        let round = &ctx.accounts.round;
        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, FlipsyError::AlreadyClaimed);
        require!(round.outcome != Outcome::Unresolved, FlipsyError::NotResolved);
        require!(
            clock.unix_timestamp < round.resolved_at + claim_forfeit_delay,
            FlipsyError::ClaimExpired
        );

        let (payout, fee) = compute_payout(round, bet, fee_bps)?;
        bet.claimed = true;

        if payout > 0 || fee > 0 {
            let vault_info = ctx.accounts.vault.to_account_info();
            let user_info = ctx.accounts.user.to_account_info();
            let authority_info = ctx.accounts.authority.to_account_info();
            if payout > 0 {
                **vault_info.try_borrow_mut_lamports()? -= payout;
                **user_info.try_borrow_mut_lamports()? += payout;
            }
            if fee > 0 {
                **vault_info.try_borrow_mut_lamports()? -= fee;
                **authority_info.try_borrow_mut_lamports()? += fee;
            }
        }

        emit!(Claimed {
            epoch: round.epoch,
            user: bet.user,
            bet_index: bet.bet_index,
            payout,
            fee,
        });
        Ok(())
    }
}

// ============================================================
// VALIDATION
// ============================================================
fn validate_program_params(
    fee_bps: u64,
    betting_duration: i64,
    gap_duration: i64,
    max_future_rounds: u64,
    claim_forfeit_delay: i64,
    force_refund_delay: i64,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, FlipsyError::BadParams);
    require!(
        betting_duration >= MIN_BETTING_DURATION && betting_duration <= MAX_BETTING_DURATION,
        FlipsyError::BadParams
    );
    require!(gap_duration >= 0 && gap_duration <= MAX_GAP_DURATION, FlipsyError::BadParams);
    require!(
        max_future_rounds >= 1 && max_future_rounds <= MAX_FUTURE_ROUNDS_LIMIT,
        FlipsyError::BadParams
    );
    require!(
        claim_forfeit_delay >= MIN_CLAIM_DELAY && claim_forfeit_delay <= MAX_CLAIM_DELAY,
        FlipsyError::BadParams

        FlipsyError::BadParams
    );
    require!(
        force_refund_delay >= MIN_REFUND_DELAY && force_refund_delay <= MAX_REFUND_DELAY,
        FlipsyError::BadParams
    );
    Ok(())
}

// ============================================================
// PAYOUT MATH
// ============================================================
fn compute_payout(round: &Round, bet: &Bet, fee_bps: u64) -> Result<(u64, u64)> {
    let fee_bps_u = fee_bps as u128;
    let bps_div = BPS_DIVISOR as u128;
    let bet_amt = bet.amount as u128;

    match round.outcome {
        Outcome::Unresolved => Err(FlipsyError::NotResolved.into()),
        Outcome::AllLost => Ok((0, 0)),
        Outcome::Tie => {
            let fee = bet_amt
                .checked_mul(fee_bps_u).ok_or(FlipsyError::MathOverflow)?
                .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
            let payout = bet_amt.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
            Ok((payout as u64, fee as u64))
        }
        Outcome::Heads | Outcome::Tails => {
            let winning_side = if round.outcome == Outcome::Heads { Side::Heads } else { Side::Tails };
            if bet.side != winning_side {
                return Ok((0, 0));
            }
            let winning_pool = (if winning_side == Side::Heads { round.heads_pool } else { round.tails_pool }) as u128;
            let losing_pool  = (if winning_side == Side::Heads { round.tails_pool } else { round.heads_pool }) as u128;

            if losing_pool == 0 {
                let fee = bet_amt
                    .checked_mul(fee_bps_u).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
                let payout = bet_amt.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
                Ok((payout as u64, fee as u64))
            } else {
                let total = winning_pool.checked_add(losing_pool).ok_or(FlipsyError::MathOverflow)?;
                let gross = bet_amt
                    .checked_mul(total).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(winning_pool).ok_or(FlipsyError::MathOverflow)?;
                let profit = gross.checked_sub(bet_amt).ok_or(FlipsyError::MathOverflow)?;
                let fee = profit
                    .checked_mul(fee_bps_u).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
                let payout = gross.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
                Ok((payout as u64, fee as u64))
            }
        }
    }
}

// ============================================================
// ACCOUNTS
// ============================================================
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + Config::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = signer.key() == config.authority @ FlipsyError::Unauthorized)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AuthorityOnlyRound<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(constraint = signer.key() == config.authority @ FlipsyError::Unauthorized)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartRound<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + Round::LEN,
        seeds = [b"round", (config.current_epoch + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + Vault::LEN,
        seeds = [b"vault", (config.current_epoch + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = (cranker.key() == config.authority || cranker.key() == config.cranker)
            @ FlipsyError::Unauthorized
    )]
    pub cranker: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndRound<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: authority receives funds if AllLost
    #[account(mut, address = config.authority)]
    pub authority: AccountInfo<'info>,
    #[account(
        constraint = (cranker.key() == config.authority || cranker.key() == config.cranker)
            @ FlipsyError::Unauthorized
    )]
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(target_epoch: u64, bet_index: u64, amount: u64, side: Side)]
pub struct PlaceBet<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Round::LEN,
        seeds = [b"round", target_epoch.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Vault::LEN,
        seeds = [b"vault", target_epoch.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = user,
        space = 8 + Bet::LEN,
        seeds = [
            b"bet",
            target_epoch.to_le_bytes().as_ref(),
            user.key().as_ref(),
            bet_index.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [
            b"bet",
            round.epoch.to_le_bytes().as_ref(),
            user.key().as_ref(),
            bet.bet_index.to_le_bytes().as_ref(),
        ],
        bump = bet.bump,
        has_one = user,
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: authority receives fees
    #[account(mut, address = config.authority)]
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct SweepUnclaimed<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: authority recipient
    #[account(mut, address = config.authority)]
    pub authority: AccountInfo<'info>,
    #[account(constraint = signer.key() == config.authority @ FlipsyError::Unauthorized)]
    pub signer: Signer<'info>,
}

// ============================================================
// DATA STRUCTURES
// ============================================================
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub cranker: Pubkey,
    pub current_epoch: u64,
    pub paused: bool,
    pub min_bet: u64,
    pub max_bet: u64,
    pub fee_bps: u64,
    pub betting_duration: i64,
    pub gap_duration: i64,
    pub max_future_rounds: u64,
    pub claim_forfeit_delay: i64,
    pub force_refund_delay: i64,
    pub bump: u8,
}
impl Config {
    const LEN: usize = 32 + 32 + 8 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Round {
    pub epoch: u64,
    pub start_time: i64,
    pub lock_time: i64,
    pub close_time: i64,
    pub next_start_time: i64,
    pub lock_price: i64,
    pub close_price: i64,
    pub heads_pool: u64,
    pub tails_pool: u64,
    pub bet_count: u64,
    pub outcome: Outcome,
    pub resolved_at: i64,
    pub swept: bool,
    pub bump: u8,
}
impl Round {
    const LEN: usize = 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1 + 1;
}

#[account]
pub struct Bet {
    pub user: Pubkey,
    pub epoch: u64,
    pub bet_index: u64,
    pub amount: u64,
    pub side: Side,
    pub claimed: bool,
    pub bump: u8,
}
impl Bet {
    const LEN: usize = 32 + 8 + 8 + 8 + 1 + 1 + 1;
}

#[account]
pub struct Vault {
    pub bump: u8,
}
impl Vault {
    const LEN: usize = 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Heads,
    Tails,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Unresolved,
    Heads,
    Tails,
    Tie,
    AllLost,
}

// ============================================================
// EVENTS
// ============================================================
#[event] pub struct ConfigInitialized   { pub authority: Pubkey, pub cranker: Pubkey }
#[event] pub struct AuthorityChanged    { pub old: Pubkey, pub new_authority: Pubkey }
#[event] pub struct BetLimitsChanged    { pub min_bet: u64, pub max_bet: u64 }
#[event] pub struct ProgramParamsChanged {
    pub fee_bps: u64,
    pub betting_duration: i64,
    pub gap_duration: i64,
    pub max_future_rounds: u64,
    pub claim_forfeit_delay: i64,
    pub force_refund_delay: i64,
}
#[event] pub struct RoundStarted        { pub epoch: u64, pub lock_price: i64 }
#[event] pub struct BetPlaced           { pub epoch: u64, pub user: Pubkey, pub bet_index: u64, pub amount: u64, pub side: Side }
#[event] pub struct RoundEnded          { pub epoch: u64, pub close_price: i64, pub outcome: Outcome }
#[event] pub struct Claimed             { pub epoch: u64, pub user: Pubkey, pub bet_index: u64, pub payout: u64, pub fee: u64 }
#[event] pub struct RoundForceRefunded  { pub epoch: u64 }
#[event] pub struct PauseToggled        { pub paused: bool }
#[event] pub struct UnclaimedSwept      { pub epoch: u64, pub amount: u64 }
#[event] pub struct SuperSwept          { pub epoch: u64, pub amount: u64 }

// ============================================================
// ERRORS
// ============================================================
#[error_code]
pub enum FlipsyError {
    #[msg("Unauthorized")]            Unauthorized,
    #[msg("Program paused")]          Paused,
    #[msg("Below minimum bet")]       BelowMin,
    #[msg("Above maximum bet")]       AboveMax,
    #[msg("Round locked")]            RoundLocked,
    #[msg("Round not started yet")]   RoundNotStarted,
    #[msg("Round not closed yet")]    RoundNotClosed,
    #[msg("Already resolved")]        AlreadyResolved,
    #[msg("Already claimed")]         AlreadyClaimed,
    #[msg("Not resolved")]            NotResolved,
    #[msg("Round out of range")]      RoundOutOfRange,
    #[msg("Too early for refund")]    TooEarlyForRefund,
    #[msg("Too early for sweep")]     TooEarlyForSweep,
    #[msg("Already swept")]           AlreadySwept,
    #[msg("Claim window expired")]    ClaimExpired,
    #[msg("Bad price")]               BadPrice,
    #[msg("Math overflow")]           MathOverflow,
    #[msg("Bad parameters")]          BadParams,
}
