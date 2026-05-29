use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use pyth_sdk_solana::state::SolanaPriceAccount;

declare_id!("");
 
// ============ CONSTANTS ============
const ROUND_DURATION: i64 = 300; // 5 minutes
const MIN_BET: u64 = 100_000;    // $0.10 USDC (6 decimals)
const MAX_BET: u64 = 5_000_000;  // $5.00 USDC
const DEPOSIT_FEE_BPS: u64 = 500;   // 5%
const WIN_FEE_BPS: u64 = 1500;      // 15%
const FORCE_REFUND_DELAY: i64 = 86400;       // 24h
const EMERGENCY_SWEEP_DELAY: i64 = 259200;   // 3 days
const BPS_DIVISOR: u64 = 10_000;

// ============ PROGRAM ============
#[program]
pub mod flipsy {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.pyth_feed = ctx.accounts.pyth_feed.key();
        config.treasury = ctx.accounts.treasury.key();
        config.current_epoch = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized { admin: config.admin });
        Ok(())
    }

    pub fn start_round(ctx: Context<StartRound>) -> Result<()> {
        require!(!ctx.accounts.config.paused, FlipsyError::Paused);
        let clock = Clock::get()?;
        let lock_price = read_pyth_price(&ctx.accounts.pyth_feed, clock.unix_timestamp)?;

        let config = &mut ctx.accounts.config;
        config.current_epoch = config.current_epoch.checked_add(1).unwrap();

        let round = &mut ctx.accounts.round;
        round.epoch = config.current_epoch;
        round.start_time = clock.unix_timestamp;
        round.lock_time = clock.unix_timestamp + ROUND_DURATION;
        round.close_time = clock.unix_timestamp + (ROUND_DURATION * 2);
        round.lock_price = lock_price;
        round.close_price = 0;
        round.heads_pool = 0;
        round.tails_pool = 0;
        round.outcome = Outcome::Unresolved;
        round.resolved_at = 0;
        round.swept = false;
        round.bump = ctx.bumps.round;

        emit!(RoundStarted { epoch: round.epoch, lock_price });
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, side: Side) -> Result<()> {
        require!(!ctx.accounts.config.paused, FlipsyError::Paused);
        require!(amount >= MIN_BET, FlipsyError::BelowMin);
        require!(amount <= MAX_BET, FlipsyError::AboveMax);

        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(clock.unix_timestamp < round.lock_time, FlipsyError::RoundLocked);

        let fee = amount.checked_mul(DEPOSIT_FEE_BPS).unwrap().checked_div(BPS_DIVISOR).unwrap();
        let net = amount.checked_sub(fee).unwrap();

        // Transfer fee to treasury
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            fee,
        )?;

        // Transfer net to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.user = ctx.accounts.user.key();
        bet.epoch = round.epoch;
        bet.amount = net;
        bet.side = side;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        match side {
            Side::Heads => round.heads_pool = round.heads_pool.checked_add(net).unwrap(),
            Side::Tails => round.tails_pool = round.tails_pool.checked_add(net).unwrap(),
        }

        emit!(BetPlaced { epoch: round.epoch, user: bet.user, amount: net, side });
        Ok(())
    }

    pub fn end_round(ctx: Context<EndRound>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
        require!(clock.unix_timestamp >= round.close_time, FlipsyError::RoundNotClosed);

        let close_price = read_pyth_price(&ctx.accounts.pyth_feed, clock.unix_timestamp)?;
        round.close_price = close_price;
        round.resolved_at = clock.unix_timestamp;

        round.outcome = if round.heads_pool == 0 || round.tails_pool == 0 {
            Outcome::NoWinners
        } else if close_price > round.lock_price {
            Outcome::Heads
        } else if close_price < round.lock_price {
            Outcome::Tails
        } else {
            Outcome::Tie
        };

        emit!(RoundEnded {
            epoch: round.epoch,
            close_price,
            outcome: round.outcome,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let round = &ctx.accounts.round;
        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, FlipsyError::AlreadyClaimed);
        require!(round.outcome != Outcome::Unresolved, FlipsyError::NotResolved);

        let payout = match round.outcome {
            Outcome::Tie => bet.amount, // full refund
            Outcome::NoWinners => 0, // pool swept by admin
            Outcome::Heads => {
                if bet.side == Side::Heads {
                    let total = round.heads_pool.checked_add(round.tails_pool).unwrap();
                    let gross = (bet.amount as u128)
                        .checked_mul(total as u128).unwrap()
                        .checked_div(round.heads_pool as u128).unwrap() as u64;
                    let win_fee = gross.checked_mul(WIN_FEE_BPS).unwrap().checked_div(BPS_DIVISOR).unwrap();
                    gross.checked_sub(win_fee).unwrap()
                } else { 0 }
            }
            Outcome::Tails => {
                if bet.side == Side::Tails {
                    let total = round.heads_pool.checked_add(round.tails_pool).unwrap();
                    let gross = (bet.amount as u128)
                        .checked_mul(total as u128).unwrap()
                        .checked_div(round.tails_pool as u128).unwrap() as u64;
                    let win_fee = gross.checked_mul(WIN_FEE_BPS).unwrap().checked_div(BPS_DIVISOR).unwrap();
                    gross.checked_sub(win_fee).unwrap()
                } else { 0 }
            }
            Outcome::Unresolved => return Err(FlipsyError::NotResolved.into()),
        };

        bet.claimed = true;

        if payout > 0 {
            let epoch_bytes = round.epoch.to_le_bytes();
            let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
            let signer = &[seeds];

            // Pay winner from vault
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    signer,
                ),
                payout,
            )?;

            // Pay winning fee to treasury (only on wins, not refunds)
            if round.outcome == Outcome::Heads || round.outcome == Outcome::Tails {
                let total = round.heads_pool.checked_add(round.tails_pool).unwrap();
                let winning_pool = if round.outcome == Outcome::Heads { round.heads_pool } else { round.tails_pool };
                let gross = (bet.amount as u128)
                    .checked_mul(total as u128).unwrap()
                    .checked_div(winning_pool as u128).unwrap() as u64;
                let win_fee = gross.checked_mul(WIN_FEE_BPS).unwrap().checked_div(BPS_DIVISOR).unwrap();

                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ctx.accounts.treasury_usdc.to_account_info(),
                            authority: ctx.accounts.vault.to_account_info(),
                        },
                        signer,
                    ),
                    win_fee,
                )?;
            }
        }

        emit!(Claimed { epoch: round.epoch, user: bet.user, payout });
        Ok(())
    }

    pub fn force_refund(ctx: Context<ForceRefund>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
        require!(
            clock.unix_timestamp >= round.close_time + FORCE_REFUND_DELAY,
            FlipsyError::TooEarlyForRefund
        );
        round.outcome = Outcome::Tie;
        round.resolved_at = clock.unix_timestamp;
        emit!(RoundForceRefunded { epoch: round.epoch });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseToggled { paused });
        Ok(())
    }

    pub fn sweep_no_winners(ctx: Context<SweepNoWinners>) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(round.outcome == Outcome::NoWinners, FlipsyError::NotNoWinners);
        require!(!round.swept, FlipsyError::AlreadySwept);

        let total = round.heads_pool.checked_add(round.tails_pool).unwrap();
        if total > 0 {
            let epoch_bytes = round.epoch.to_le_bytes();
            let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.treasury_usdc.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    &[seeds],
                ),
                total,
            )?;
        }
        round.swept = true;
        emit!(NoWinnersSwept { epoch: round.epoch, amount: total });
        Ok(())
    }

    pub fn emergency_sweep(ctx: Context<EmergencySweep>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(round.resolved_at > 0, FlipsyError::NotResolved);
        require!(
            clock.unix_timestamp >= round.resolved_at + EMERGENCY_SWEEP_DELAY,
            FlipsyError::TooEarlyForEmergency
        );
        require!(!round.swept, FlipsyError::AlreadySwept);

        let balance = ctx.accounts.vault.amount;
        if balance > 0 {
            let epoch_bytes = round.epoch.to_le_bytes();
            let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.treasury_usdc.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    &[seeds],
                ),
                balance,
            )?;
        }
        round.swept = true;
        emit!(EmergencySwept { epoch: round.epoch, amount: balance });
        Ok(())
    }
}

// ============ PYTH HELPER ============
fn read_pyth_price(feed_info: &AccountInfo, current_ts: i64) -> Result<i64> {
    let price_feed = SolanaPriceAccount::account_info_to_feed(feed_info)
        .map_err(|_| FlipsyError::PythError)?;
    let price = price_feed.get_price_no_older_than(current_ts, 60)
        .ok_or(FlipsyError::PythStale)?;
    // Normalize to 8 decimals
    let raw = price.price;
    let expo = price.expo;
    let normalized = if expo >= -8 {
        raw.checked_mul(10_i64.pow((expo + 8) as u32)).ok_or(FlipsyError::PythOverflow)?
    } else {
        raw.checked_div(10_i64.pow((-expo - 8) as u32)).ok_or(FlipsyError::PythOverflow)?
    };
    Ok(normalized)
}

// ============ ACCOUNTS ============
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, payer = admin, space = 8 + Config::LEN,
        seeds = [b"config"], bump
    )]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: Pyth feed validated at read time
    pub pyth_feed: AccountInfo<'info>,
    #[account(token::mint = usdc_mint)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartRound<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = cranker, space = 8 + Round::LEN,
        seeds = [b"round", (config.current_epoch + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init, payer = cranker,
        seeds = [b"vault", (config.current_epoch + 1).to_le_bytes().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: Pyth feed validated at read time
    #[account(address = config.pyth_feed)]
    pub pyth_feed: AccountInfo<'info>,
    #[account(mut)]
    pub cranker: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, side: Side)]
pub struct PlaceBet<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        init, payer = user, space = 8 + Bet::LEN,
        seeds = [b"bet", round.epoch.to_le_bytes().as_ref(), user.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        token::authority = config.treasury,
        address = config.treasury,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndRound<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: Pyth feed validated at read time
    #[account(address = config.pyth_feed)]
    pub pyth_feed: AccountInfo<'info>,
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"bet", round.epoch.to_le_bytes().as_ref(), user.key().as_ref()],
        bump = bet.bump,
        has_one = user,
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        token::authority = config.treasury,
        address = config.treasury,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ForceRefund<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SweepNoWinners<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        token::authority = config.treasury,
        address = config.treasury,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencySweep<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        token::authority = config.treasury,
        address = config.treasury,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ============ STATE ============
#[account]
pub struct Config {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub pyth_feed: Pubkey,
    pub treasury: Pubkey,
    pub current_epoch: u64,
    pub paused: bool,
    pub bump: u8,
}
impl Config { const LEN: usize = 32 * 4 + 8 + 1 + 1; }

#[account]
pub struct Round {
    pub epoch: u64,
    pub start_time: i64,
    pub lock_time: i64,
    pub close_time: i64,
    pub lock_price: i64,
    pub close_price: i64,
    pub heads_pool: u64,
    pub tails_pool: u64,
    pub outcome: Outcome,
    pub resolved_at: i64,
    pub swept: bool,
    pub bump: u8,
}
impl Round { const LEN: usize = 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 1 + 1; }

#[account]
pub struct Bet {
    pub user: Pubkey,
    pub epoch: u64,
    pub amount: u64,
    pub side: Side,
    pub claimed: bool,
    pub bump: u8,
}
impl Bet { const LEN: usize = 32 + 8 + 8 + 1 + 1 + 1; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side { Heads, Tails }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome { Unresolved, Heads, Tails, Tie, NoWinners }

// ============ EVENTS ============
#[event] pub struct ConfigInitialized { pub admin: Pubkey }
#[event] pub struct RoundStarted { pub epoch: u64, pub lock_price: i64 }
#[event] pub struct BetPlaced { pub epoch: u64, pub user: Pubkey, pub amount: u64, pub side: Side }
#[event] pub struct RoundEnded { pub epoch: u64, pub close_price: i64, pub outcome: Outcome }
#[event] pub struct Claimed { pub epoch: u64, pub user: Pubkey, pub payout: u64 }
#[event] pub struct RoundForceRefunded { pub epoch: u64 }
#[event] pub struct PauseToggled { pub paused: bool }
#[event] pub struct NoWinnersSwept { pub epoch: u64, pub amount: u64 }
#[event] pub struct EmergencySwept { pub epoch: u64, pub amount: u64 }

// ============ ERRORS ============
#[error_code]
pub enum FlipsyError {
    #[msg("Program paused")] Paused,
    #[msg("Below minimum bet")] BelowMin,
    #[msg("Above maximum bet")] AboveMax,
    #[msg("Round locked")] RoundLocked,
    #[msg("Round not closed yet")] RoundNotClosed,
    #[msg("Already resolved")] AlreadyResolved,
    #[msg("Already claimed")] AlreadyClaimed,
    #[msg("Not resolved")] NotResolved,
    #[msg("Too early for refund")] TooEarlyForRefund,
    #[msg("Too early for emergency sweep")] TooEarlyForEmergency,
    #[msg("Not a no-winners round")] NotNoWinners,
    #[msg("Already swept")] AlreadySwept,
    #[msg("Pyth read error")] PythError,
    #[msg("Pyth price stale")] PythStale,
    #[msg("Pyth math overflow")] PythOverflow,
}
