use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use pyth_sdk_solana::load_price_feed_from_account_info;

declare_id!("11111111111111111111111111111111");

const BPS_DIVISOR: u64 = 10_000;
const FORCE_REFUND_DELAY: i64 = 86_400;
const EMERGENCY_SWEEP_DELAY: i64 = 259_200;
const MAX_FEE_BPS: u16 = 3000;
const PYTH_MAX_AGE: u64 = 60;

#[program]
pub mod flipsy {
  use super::*;

  pub fn initialize(ctx: Context<Initialize>, round_duration: i64, min_bet: u64, max_bet: u64, fee_bps: u16, solo_fee_bps: u16) -> Result<()> {
      require!(round_duration >= 60, FlipsyError::BadParams);
      require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
      require!(fee_bps <= MAX_FEE_BPS, FlipsyError::BadParams);
      require!(solo_fee_bps <= MAX_FEE_BPS, FlipsyError::BadParams);
      let config = &mut ctx.accounts.config;
      config.admin = ctx.accounts.admin.key();
      config.usdc_mint = ctx.accounts.usdc_mint.key();
      config.pyth_feed = ctx.accounts.pyth_feed.key();
      config.treasury = ctx.accounts.treasury.key();
      config.current_epoch = 0;
      config.paused = false;
      config.round_duration = round_duration;
      config.min_bet = min_bet;
      config.max_bet = max_bet;
      config.fee_bps = fee_bps;
      config.solo_fee_bps = solo_fee_bps;
      config.bump = ctx.bumps.config;
      emit!(ConfigInitialized { admin: config.admin });
      Ok(())
  }

  pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
      Ok(())
  }

  pub fn set_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
      ctx.accounts.config.admin = new_admin;
      Ok(())
  }

  pub fn set_treasury(ctx: Context<AdminOnly>, new_treasury: Pubkey) -> Result<()> {
      ctx.accounts.config.treasury = new_treasury;
      Ok(())
  }

  pub fn set_pyth_feed(ctx: Context<AdminOnly>, new_feed: Pubkey) -> Result<()> {
      ctx.accounts.config.pyth_feed = new_feed;
      Ok(())
  }

  pub fn set_params(ctx: Context<AdminOnly>, round_duration: i64, min_bet: u64, max_bet: u64, fee_bps: u16, solo_fee_bps: u16) -> Result<()> {
      require!(round_duration >= 60, FlipsyError::BadParams);
      require!(min_bet > 0 && max_bet >= min_bet, FlipsyError::BadParams);
      require!(fee_bps <= MAX_FEE_BPS, FlipsyError::BadParams);
      require!(solo_fee_bps <= MAX_FEE_BPS, FlipsyError::BadParams);
      let c = &mut ctx.accounts.config;
      c.round_duration = round_duration;
      c.min_bet = min_bet;
      c.max_bet = max_bet;
      c.fee_bps = fee_bps;
      c.solo_fee_bps = solo_fee_bps;
      Ok(())
  }

  pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
      ctx.accounts.config.paused = paused;
      emit!(PauseToggled { paused });
      Ok(())
  }

  pub fn start_round(ctx: Context<StartRound>) -> Result<()> {
      require!(!ctx.accounts.config.paused, FlipsyError::Paused);
      let clock = Clock::get()?;
      let lock_price = read_pyth_price(&ctx.accounts.pyth_feed, &clock)?;
      let config = &mut ctx.accounts.config;
      config.current_epoch = config.current_epoch.checked_add(1).ok_or(FlipsyError::MathOverflow)?;
      let round = &mut ctx.accounts.round;
      round.epoch = config.current_epoch;
      round.start_time = clock.unix_timestamp;
      round.lock_time = clock.unix_timestamp + config.round_duration;
      round.close_time = clock.unix_timestamp + (config.round_duration * 2);
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
      let config = &ctx.accounts.config;
      require!(!config.paused, FlipsyError::Paused);
      require!(amount >= config.min_bet, FlipsyError::BelowMin);
      require!(amount <= config.max_bet, FlipsyError::AboveMax);
      let clock = Clock::get()?;
      let round = &mut ctx.accounts.round;
      require!(clock.unix_timestamp < round.lock_time, FlipsyError::RoundLocked);
      token::transfer(
          CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
              from: ctx.accounts.user_usdc.to_account_info(),
              to: ctx.accounts.vault.to_account_info(),
              authority: ctx.accounts.user.to_account_info(),
          }),
          amount,
      )?;
      let bet = &mut ctx.accounts.bet;
      bet.user = ctx.accounts.user.key();
      bet.epoch = round.epoch;
      bet.amount = amount;
      bet.side = side;
      bet.claimed = false;
      bet.bump = ctx.bumps.bet;
      match side {
          Side::Heads => round.heads_pool = round.heads_pool.checked_add(amount).ok_or(FlipsyError::MathOverflow)?,
          Side::Tails => round.tails_pool = round.tails_pool.checked_add(amount).ok_or(FlipsyError::MathOverflow)?,
      }
      emit!(BetPlaced { epoch: round.epoch, user: bet.user, amount, side });
      Ok(())
  }

  pub fn end_round(ctx: Context<EndRound>) -> Result<()> {
      let clock = Clock::get()?;
      let round = &mut ctx.accounts.round;
      require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
      require!(clock.unix_timestamp >= round.close_time, FlipsyError::RoundNotClosed);
      let close_price = read_pyth_price(&ctx.accounts.pyth_feed, &clock)?;
      round.close_price = close_price;
      round.resolved_at = clock.unix_timestamp;
      round.outcome = if close_price == round.lock_price {
          Outcome::Tie
      } else if close_price > round.lock_price {
          if round.heads_pool > 0 { Outcome::Heads } else { Outcome::AllLost }
      } else {
          if round.tails_pool > 0 { Outcome::Tails } else { Outcome::AllLost }
      };
      emit!(RoundEnded { epoch: round.epoch, close_price, outcome: round.outcome });
      Ok(())
  }

  pub fn claim(ctx: Context<Claim>) -> Result<()> {
      let config = &ctx.accounts.config;
      let round = &ctx.accounts.round;
      let bet = &mut ctx.accounts.bet;
      require!(!bet.claimed, FlipsyError::AlreadyClaimed);
      require!(round.outcome != Outcome::Unresolved, FlipsyError::NotResolved);
      let (payout, fee) = compute_payout(round, bet, config.fee_bps, config.solo_fee_bps)?;
      bet.claimed = true;
      if payout > 0 || fee > 0 {
          let epoch_bytes = round.epoch.to_le_bytes();
          let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
          let signer = &[seeds];
          if payout > 0 {
              token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                  from: ctx.accounts.vault.to_account_info(),
                  to: ctx.accounts.user_usdc.to_account_info(),
                  authority: ctx.accounts.vault.to_account_info(),
              }, signer), payout)?;
          }
          if fee > 0 {
              token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                  from: ctx.accounts.vault.to_account_info(),
                  to: ctx.accounts.treasury_usdc.to_account_info(),
                  authority: ctx.accounts.vault.to_account_info(),
              }, signer), fee)?;
          }
      }
      emit!(Claimed { epoch: round.epoch, user: bet.user, payout, fee });
      Ok(())
  }

  pub fn force_refund(ctx: Context<ForceRefund>) -> Result<()> {
      let clock = Clock::get()?;
      let round = &mut ctx.accounts.round;
      require!(round.outcome == Outcome::Unresolved, FlipsyError::AlreadyResolved);
      require!(clock.unix_timestamp >= round.close_time + FORCE_REFUND_DELAY, FlipsyError::TooEarlyForRefund);
      round.outcome = Outcome::Tie;
      round.resolved_at = clock.unix_timestamp;
      emit!(RoundForceRefunded { epoch: round.epoch });
      Ok(())
  }

  pub fn sweep_all_lost(ctx: Context<SweepAllLost>) -> Result<()> {
      let round = &mut ctx.accounts.round;
      require!(round.outcome == Outcome::AllLost, FlipsyError::NotAllLost);
      require!(!round.swept, FlipsyError::AlreadySwept);
      let total = round.heads_pool.checked_add(round.tails_pool).ok_or(FlipsyError::MathOverflow)?;
      if total > 0 {
          let epoch_bytes = round.epoch.to_le_bytes();
          let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
          token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
              from: ctx.accounts.vault.to_account_info(),
              to: ctx.accounts.treasury_usdc.to_account_info(),
              authority: ctx.accounts.vault.to_account_info(),
          }, &[seeds]), total)?;
      }
      round.swept = true;
      emit!(AllLostSwept { epoch: round.epoch, amount: total });
      Ok(())
  }

  pub fn emergency_sweep(ctx: Context<EmergencySweep>) -> Result<()> {
      let clock = Clock::get()?;
      let round = &mut ctx.accounts.round;
      require!(round.resolved_at > 0, FlipsyError::NotResolved);
      require!(clock.unix_timestamp >= round.resolved_at + EMERGENCY_SWEEP_DELAY, FlipsyError::TooEarlyForEmergency);
      require!(!round.swept, FlipsyError::AlreadySwept);
      let balance = ctx.accounts.vault.amount;
      if balance > 0 {
          let epoch_bytes = round.epoch.to_le_bytes();
          let seeds: &[&[u8]] = &[b"vault", epoch_bytes.as_ref(), &[ctx.bumps.vault]];
          token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
              from: ctx.accounts.vault.to_account_info(),
              to: ctx.accounts.treasury_usdc.to_account_info(),
              authority: ctx.accounts.vault.to_account_info(),
          }, &[seeds]), balance)?;
      }
      round.swept = true;
      emit!(EmergencySwept { epoch: round.epoch, amount: balance });
      Ok(())
  }
}

fn read_pyth_price(feed_info: &AccountInfo, clock: &Clock) -> Result<i64> {
    let price_feed = load_price_feed_from_account_info(feed_info)
        .map_err(|_| FlipsyError::PythError)?;
    let current_price = price_feed
        .get_price_no_older_than(clock.unix_timestamp, PYTH_MAX_AGE)
        .ok_or(FlipsyError::PythStale)?;
    let expo = current_price.expo;
    let raw = current_price.price;
    let normalized = if expo >= -8 {
        raw.checked_mul(10_i64.pow((expo + 8) as u32))
            .ok_or(FlipsyError::PythOverflow)?
    } else {
        raw.checked_div(10_i64.pow((-expo - 8) as u32))
            .ok_or(FlipsyError::PythOverflow)?
    };
    Ok(normalized)
}

fn compute_payout(round: &Round, bet: &Bet, fee_bps: u16, solo_fee_bps: u16) -> Result<(u64, u64)> {
  let fee_bps  = fee_bps as u128;
  let solo_bps = solo_fee_bps as u128;
  let bps_div  = BPS_DIVISOR as u128;
  let bet_amt  = bet.amount as u128;
  match round.outcome {
      Outcome::Unresolved => Err(FlipsyError::NotResolved.into()),
      Outcome::AllLost    => Ok((0, 0)),
      Outcome::Tie        => Ok((bet.amount, 0)),
      Outcome::Heads | Outcome::Tails => {
          let winning_side = if round.outcome == Outcome::Heads { Side::Heads } else { Side::Tails };
          if bet.side != winning_side { return Ok((0, 0)); }
          let winning_pool = if winning_side == Side::Heads { round.heads_pool } else { round.tails_pool } as u128;
          let losing_pool  = if winning_side == Side::Heads { round.tails_pool } else { round.heads_pool } as u128;
          if losing_pool == 0 {
              let fee = bet_amt.checked_mul(solo_bps).ok_or(FlipsyError::MathOverflow)?.checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
              let payout = bet_amt.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
              Ok((payout as u64, fee as u64))
          } else {
              let total = winning_pool.checked_add(losing_pool).ok_or(FlipsyError::MathOverflow)?;
              let gross = bet_amt.checked_mul(total).ok_or(FlipsyError::MathOverflow)?.checked_div(winning_pool).ok_or(FlipsyError::MathOverflow)?;
              let profit = gross.checked_sub(bet_amt).ok_or(FlipsyError::MathOverflow)?;
              let fee = profit.checked_mul(fee_bps).ok_or(FlipsyError::MathOverflow)?.checked_div(bps_div).ok_or(FlipsyError::MathOverflow)?;
              let payout = gross.checked_sub(fee).ok_or(FlipsyError::MathOverflow)?;
              Ok((payout as u64, fee as u64))
          }
      }
  }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
  #[account(init, payer = admin, space = 8 + Config::LEN, seeds = [b"config"], bump)]
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
pub struct CloseConfig<'info> {
  #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin, close = admin)]
  pub config: Account<'info, Config>,
  #[account(mut)]
  pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
  #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
  pub config: Account<'info, Config>,
  pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartRound<'info> {
  #[account(mut, seeds = [b"config"], bump = config.bump)]
  pub config: Account<'info, Config>,
  #[account(init, payer = cranker, space = 8 + Round::LEN, seeds = [b"round", (config.current_epoch + 1).to_le_bytes().as_ref()], bump)]
  pub round: Account<'info, Round>,
  #[account(init, payer = cranker, seeds = [b"vault", (config.current_epoch + 1).to_le_bytes().as_ref()], bump, token::mint = usdc_mint, token::authority = vault)]
  pub vault: Account<'info, TokenAccount>,
  pub usdc_mint: Account<'info, Mint>,
  /// CHECK: Pyth feed
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
  #[account(init, payer = user, space = 8 + Bet::LEN, seeds = [b"bet", round.epoch.to_le_bytes().as_ref(), user.key().as_ref()], bump)]
  pub bet: Account<'info, Bet>,
  #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
  pub vault: Account<'info, TokenAccount>,
  #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
  pub user_usdc: Account<'info, TokenAccount>,
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
  /// CHECK: Pyth feed
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
  #[account(mut, seeds = [b"bet", round.epoch.to_le_bytes().as_ref(), user.key().as_ref()], bump = bet.bump, has_one = user)]
  pub bet: Account<'info, Bet>,
  #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
  pub vault: Account<'info, TokenAccount>,
  #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
  pub user_usdc: Account<'info, TokenAccount>,
  #[account(mut, address = config.treasury)]
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
pub struct SweepAllLost<'info> {
  #[account(seeds = [b"config"], bump = config.bump, has_one = admin)]
  pub config: Account<'info, Config>,
  #[account(mut, seeds = [b"round", round.epoch.to_le_bytes().as_ref()], bump = round.bump)]
  pub round: Account<'info, Round>,
  #[account(mut, seeds = [b"vault", round.epoch.to_le_bytes().as_ref()], bump)]
  pub vault: Account<'info, TokenAccount>,
  #[account(mut, address = config.treasury)]
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
  #[account(mut, address = config.treasury)]
  pub treasury_usdc: Account<'info, TokenAccount>,
  pub admin: Signer<'info>,
  pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
  pub admin: Pubkey,
  pub usdc_mint: Pubkey,
  pub pyth_feed: Pubkey,
  pub treasury: Pubkey,
  pub current_epoch: u64,
  pub paused: bool,
  pub round_duration: i64,
  pub min_bet: u64,
  pub max_bet: u64,
  pub fee_bps: u16,
  pub solo_fee_bps: u16,
  pub bump: u8,
}
impl Config { const LEN: usize = 32*4 + 8 + 1 + 8 + 8 + 8 + 2 + 2 + 1; }

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
impl Round { const LEN: usize = 8*8 + 1 + 8 + 1 + 1; }

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
pub enum Outcome { Unresolved, Heads, Tails, Tie, AllLost }

#[event] pub struct ConfigInitialized { pub admin: Pubkey }
#[event] pub struct RoundStarted { pub epoch: u64, pub lock_price: i64 }
#[event] pub struct BetPlaced { pub epoch: u64, pub user: Pubkey, pub amount: u64, pub side: Side }
#[event] pub struct RoundEnded { pub epoch: u64, pub close_price: i64, pub outcome: Outcome }
#[event] pub struct Claimed { pub epoch: u64, pub user: Pubkey, pub payout: u64, pub fee: u64 }
#[event] pub struct RoundForceRefunded { pub epoch: u64 }
#[event] pub struct PauseToggled { pub paused: bool }
#[event] pub struct AllLostSwept { pub epoch: u64, pub amount: u64 }
#[event] pub struct EmergencySwept { pub epoch: u64, pub amount: u64 }

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
  #[msg("Not an all-lost round")] NotAllLost,
  #[msg("Already swept")] AlreadySwept,
  #[msg("Pyth read error")] PythError,
  #[msg("Pyth price stale")] PythStale,
  #[msg("Pyth math overflow")] PythOverflow,
  #[msg("Math overflow")] MathOverflow,
  #[msg("Bad parameters")] BadParams,
}
