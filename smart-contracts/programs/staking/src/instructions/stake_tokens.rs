use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Mint, Token};

use crate::state::{StakingProgram, StakePool, UserStake, StakingTier};
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct StakeTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The staking program account
    #[account(
        seeds = [b"staking_program"],
        bump = staking_program.bump,
        constraint = !staking_program.config.paused @ StakingError::StakingPaused
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// The stake pool to stake in
    #[account(
        mut,
        constraint = stake_pool.active @ StakingError::StakePoolNotActive,
        constraint = stake_pool.config.accepting_stakes @ StakingError::StakePoolNotActive,
        constraint = stake_pool.has_capacity(amount) @ StakingError::MaximumStakeExceeded
    )]
    pub stake_pool: Account<'info, StakePool>,
    
    /// User's token account (source of tokens to stake)
    #[account(
        mut,
        constraint = user_token_account.mint == stake_pool.stake_token_mint,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.amount >= amount @ StakingError::InsufficientStakedBalance
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Vault holding staked tokens
    #[account(
        mut,
        constraint = stake_vault.key() == stake_pool.stake_vault
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    /// User's stake account
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::LEN,
        seeds = [b"user_stake", stake_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    // Validate stake amount
    require!(amount > 0, StakingError::InvalidStakeAmount);
    require!(
        amount >= stake_pool.config.min_stake_amount,
        StakingError::MinimumStakeNotMet
    );
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Update pool rewards before changing staked amounts
    stake_pool.update_rewards(current_time)?;
    
    // Initialize user stake if this is their first stake
    if user_stake.user != ctx.accounts.user.key() {
        user_stake.stake_pool = stake_pool.key();
        user_stake.user = ctx.accounts.user.key();
        user_stake.staked_amount = 0;
        user_stake.initial_stake_time = current_time;
        user_stake.last_stake_time = current_time;
        user_stake.last_reward_time = current_time;
        user_stake.pending_rewards = 0;
        user_stake.total_rewards_claimed = 0;
        user_stake.reward_per_token_paid = stake_pool.accumulated_reward_per_token;
        user_stake.unstake_request = None;
        user_stake.staking_tier = StakingTier::Bronze;
        user_stake.bump = *ctx.bumps.get("user_stake").unwrap();
        
        // Increment staker count for new stakers
        stake_pool.staker_count += 1;
    } else {
        // Calculate and update pending rewards for existing staker
        let pending_rewards = user_stake.calculate_pending_rewards(stake_pool.accumulated_reward_per_token)?;
        user_stake.pending_rewards = pending_rewards;
        user_stake.reward_per_token_paid = stake_pool.accumulated_reward_per_token;
    }
    
    // Check maximum stake limit
    let new_total_staked = user_stake.staked_amount + amount;
    require!(
        new_total_staked <= stake_pool.config.max_stake_amount,
        StakingError::MaximumStakeExceeded
    );
    
    // Transfer tokens from user to stake vault
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.stake_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    
    // Update user stake
    user_stake.staked_amount = new_total_staked;
    user_stake.last_stake_time = current_time;
    user_stake.update_tier();
    
    // Update pool totals
    stake_pool.total_staked = stake_pool.total_staked.checked_add(amount).unwrap();
    
    msg!(
        "User {} staked {} tokens in pool {}. New balance: {}",
        ctx.accounts.user.key(),
        amount,
        stake_pool.pool_id,
        user_stake.staked_amount
    );
    
    Ok(())
}
