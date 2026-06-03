use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::solana_program::program::invoke;

declare_id!("4npVSUH3hx62E5VJSWdoCyUwfBnZirMxzqfDNWNCcYbT");

const SUPER_ADMIN: Pubkey = pubkey!("GBmnZawAWuYfJtm2GhqS5aAXtxjgiEZ2BWKqNtsyrdLA");

const FEE_BPS: u64 = 2_500;
const BPS_DIVISOR: u64 = 10_000;
const BETTING_DURATION: i64 = 360;
const GAP_DURATION: i64 = 30;
const MAX_FUTURE_ROUNDS: u64 = 20;
const FORCE_REFUND_DELAY: i64 = 86_400;
const CLAIM_FORFEIT_DELAY: i64 = 259_200;

#[program]
pub mod flipsy {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        cranker: Pubkey,
        min_bet: u64,
        max_bet: u64,
    ) -> Result<()> {
        require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
        let c = &mut ctx.accounts.config;
        c.admin = admin;
        c.cranker = cranker;
        c.current_epoch = 0;
        c.paused = false;
        c.min_bet = min_bet;
        c.max_bet = max_bet;
        c.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin, cranker });
        Ok(())
    }

    pub fn set_admin(ctx: Context<SuperAdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }

    pub fn set_cranker(ctx: Context<SuperAdminOnly>, new_cranker: Pubkey) -> Result<()> {
        ctx.accounts.config.cranker = new_cranker;
        Ok(())
    }

    pub fn set_params(
        ctx: Context<AdminOrSuper>,
        min_bet: u64,
        max_bet: u64,
    ) -> Result<()> {
        require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
        let c = &mut ctx.accounts.config;
        c.min_bet = min_bet;
        c.max_bet = max_bet;
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOrSuper>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseToggled { paused });
        Ok(())
    }

    pub fn super_sweep(ctx: Context<SuperSweep>) -> Result<()> {
        let vault_info = ctx.accounts.vault.to_account_info();
        let recipient = ctx.accounts.super_admin.to_account_info();
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

    pub fn force_refund(ctx: Context<AdminOrSuperRound>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
        require!(round.close_time > 0, FlipsyError::RoundNotStarted);
        require!(
            clock.unix_timestamp >= round.close_time + FORCE_REFUND_DELAY,
            FlipsyError::TooEarlyForRefund
        );
        round.outcome = Outcome::Tie;
        round.resolved_at = clock.unix_timestamp;
        emit!(RoundForceRefunded { epoch: round.epoch });
        Ok(())
    }

    pub fn sweep_unclaimed(ctx: Context<SweepUnclaimed>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.resolved_at > 0, FlipsyError::NotResolved);
        require!(
            clock.unix_timestamp >= round.resolved_at + CLAIM_FORFEIT_DELAY,
            FlipsyError::TooEarlyForSweep
        );
        require!(!round.swept, FlipsyError::AlreadySwept);

        let vault_info = ctx.accounts.vault.to_account_info();
        let recipient = ctx.accounts.super_admin.to_account_info();
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

    pub fn start_round(ctx: Context<StartRound>, lock_price: i64) -> Result<()> {
        require!(!ctx.accounts.config.paused, FlipsyError::Paused);
        require!(lock_price > 0, FlipsyError::BadPrice);
        let clock = Clock::get()?;
        let config = &mut ctx.accounts.config;
        config.current_epoch = config
            .current_epoch
            .checked_add(1)
            .ok_or(FlipsyError::MathOverflow)?;

        let round = &mut ctx.accounts.round;
        round.epoch = config.current_epoch;
        round.start_time = clock.unix_timestamp;
        round.lock_time = clock.unix_timestamp + BETTING_DURATION;
        round.close_time = clock.unix_timestamp + BETTING_DURATION;
        round.next_start_time = round.close_time + GAP_DURATION;
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
            if round.heads_pool > 0 {
                Outcome::Heads
            } else {
                Outcome::AllLost
            }
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
                let recipient = ctx.accounts.super_admin.to_account_info();
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

        let min_epoch = config.current_epoch.checked_add(1).ok_or(FlipsyError::MathOverflow)?;
        let max_epoch = config
            .current_epoch
            .checked_add(MAX_FUTURE_ROUNDS)
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

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let round = &ctx.accounts.round;
        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, FlipsyError::AlreadyClaimed);
        require!(round.outcome != Outcome::Unresolved, FlipsyError::NotResolved);

        let (payout, fee) = compute_payout(round, bet)?;
        bet.claimed = true;

        if payout > 0 || fee > 0 {
            let vault_info = ctx.accounts.vault.to_account_info();
            let user_info = ctx.accounts.user.to_account_info();
            let admin_info = ctx.accounts.super_admin.to_account_info();
            if payout > 0 {
                **vault_info.try_borrow_mut_lamports()? -= payout;
                **user_info.try_borrow_mut_lamports()? += payout;
            }
            if fee > 0 {
                **vault_info.try_borrow_mut_lamports()? -= fee;
                **admin_info.try_borrow_mut_lamports()? += fee;
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

fn compute_payout(round: &Round, bet: &Bet) -> Result<(u64, u64)> {
    let fee_bps = FEE_BPS as u128;
    let bps_div = BPS_DIVISOR as u128;
    let bet_amt = bet.amount as u128;

    match round.outcome {
        Outcome::Unresolved => Err(FlipsyError::NotResolved.into()),
        Outcome::AllLost => Ok((0, 0)),
        Outcome::Tie => {
            let fee = bet_amt
                .checked_mul(fee_bps).ok_or(FlipsyError::MathOverflow)?
                .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
            let payout = bet_amt.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
            Ok((payout as u64, fee as u64))
        }
        Outcome::Heads | Outcome::Tails => {
            let winning_side = if round.outcome == Outcome::Heads {
                Side::Heads
            } else {
                Side::Tails
            };
            if bet.side != winning_side {
                return Ok((0, 0));
            }
            let winning_pool = (if winning_side == Side::Heads {
                round.heads_pool
            } else {
                round.tails_pool
            }) as u128;
            let losing_pool = (if winning_side == Side::Heads {
                round.tails_pool
            } else {
                round.heads_pool
            }) as u128;

            if losing_pool == 0 {
                let fee = bet_amt
                    .checked_mul(fee_bps).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
                let payout = bet_amt.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
                Ok((payout as u64, fee as u64))
            } else {
                let total = winning_pool
                    .checked_add(losing_pool).ok_or(FlipsyError::MathOverflow)?;
                let gross = bet_amt
                    .checked_mul(total).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(winning_pool).ok_or(FlipsyError::MathOverflow)?;
                let profit = gross.checked_sub(bet_amt).ok_or(FlipsyError::MathOverflow)?;
                let fee = profit
                    .checked_mul(fee_bps).ok_or(FlipsyError::MathOverflow)?
                    .checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
                let payout = gross.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
                Ok((payout as u64, fee as u64))
            }
        }
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + Config::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SuperAdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = signer.key() == SUPER_ADMIN @ FlipsyError::Unauthorized)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOrSuper<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        constraint = (signer.key() == SUPER_ADMIN || signer.key() == config.admin)
            @ FlipsyError::Unauthorized
    )]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOrSuperRound<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        constraint = (signer.key() == SUPER_ADMIN || signer.key() == config.admin)
            @ FlipsyError::Unauthorized
    )]
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
        constraint = (cranker.key() == SUPER_ADMIN || cranker.key() == config.cranker)
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
    /// CHECK: hardcoded SUPER_ADMIN, recipient if AllLost
    #[account(mut, address = SUPER_ADMIN)]
    pub super_admin: AccountInfo<'info>,
    #[account(
        constraint = (cranker.key() == SUPER_ADMIN || cranker.key() == config.cranker)
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
    /// CHECK: SUPER_ADMIN receives fee
    #[account(mut, address = SUPER_ADMIN)]
    pub super_admin: AccountInfo<'info>,
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
    /// CHECK: SUPER_ADMIN recipient
    #[account(mut, address = SUPER_ADMIN)]
    pub super_admin: AccountInfo<'info>,
    #[account(
        constraint = (signer.key() == SUPER_ADMIN || signer.key() == config.admin)
            @ FlipsyError::Unauthorized
    )]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SuperSweep<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: SUPER_ADMIN recipient
    #[account(mut, address = SUPER_ADMIN)]
    pub super_admin: AccountInfo<'info>,
    #[account(constraint = signer.key() == SUPER_ADMIN @ FlipsyError::Unauthorized)]
    pub signer: Signer<'info>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub cranker: Pubkey,
    pub current_epoch: u64,
    pub paused: bool,
    pub min_bet: u64,
    pub max_bet: u64,
    pub bump: u8,
}
impl Config {
    const LEN: usize = 32 + 32 + 8 + 1 + 8 + 8 + 1;
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

#[event] pub struct ConfigInitialized   { pub admin: Pubkey, pub cranker: Pubkey }
#[event] pub struct RoundStarted        { pub epoch: u64, pub lock_price: i64 }
#[event] pub struct BetPlaced           { pub epoch: u64, pub user: Pubkey, pub bet_index: u64, pub amount: u64, pub side: Side }
#[event] pub struct RoundEnded          { pub epoch: u64, pub close_price: i64, pub outcome: Outcome }
#[event] pub struct Claimed             { pub epoch: u64, pub user: Pubkey, pub bet_index: u64, pub payout: u64, pub fee: u64 }
#[event] pub struct RoundForceRefunded  { pub epoch: u64 }
#[event] pub struct PauseToggled        { pub paused: bool }
#[event] pub struct UnclaimedSwept      { pub epoch: u64, pub amount: u64 }
#[event] pub struct SuperSwept          { pub epoch: u64, pub amount: u64 }

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
    #[msg("Bad price")]               BadPrice,
    #[msg("Math overflow")]           MathOverflow,
    #[msg("Bad parameters")]          BadParams,
}
