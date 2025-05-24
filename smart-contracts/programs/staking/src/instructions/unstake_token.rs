use anchor_lang::prelude::*;

use crate::state::{StakingProgram, StakePool, UserStake, UnstakeRequest};
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct UnstakeTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The staking program account
    #[account(
        seeds = [b"staking_program"],
        bump = staking_program.bump
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// The stake pool to unstake from
    #[account(
        mut,
        constraint = stake_pool.active @ StakingError::StakePoolNotActive
    )]
    pub stake_pool: Account<'info, StakePool>,
    
    /// User's stake account
    #[account(
        mut,
        seeds = [b"user_stake", stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.user == user.key(),
        constraint = user_stake.staked_amount >= amount @ StakingError::InsufficientStakedBalance
    )]
    pub user_stake: Account<'info, UserStake>,
}

pub fn handler(ctx: Context<UnstakeTokens>, amount: u64) -> Result<()> {
    let staking_program = &ctx.accounts.staking_program;
    let stake_pool = &mut ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    // Validate unstake amount
    require!(amount > 0, StakingError::InvalidStakeAmount);
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if minimum staking duration has been met
    require!(
        user_stake.can_unstake(current_time, stake_pool.config.min_staking_duration),
        StakingError::MinimumStakingPeriodNotMet
    );
    
    // Check if user already has an unstaking request
    require!(
        user_stake.unstake_request.is_none(),
        StakingError::InvalidStakeAmount // User should withdraw existing unstake first
    );
    
    // Update pool rewards before changing staked amounts
    stake_pool.update_rewards(current_time)?;
    
    // Calculate and update pending rewards
    let pending_rewards = user_stake.calculate_pending_rewards(stake_pool.accumulated_reward_per_token)?;
    user_stake.pending_rewards = pending_rewards;
    user_stake.reward_per_token_paid = stake_pool.accumulated_reward_per_token;
    
    // Determine cooldown period
    let cooldown_period = stake_pool.config.cooldown_period
        .unwrap_or(staking_program.config.default_cooldown_period);
    
    // Create unstake request
    user_stake.unstake_request = Some(UnstakeRequest {
        amount,
        request_time: current_time,
        withdraw_time: current_time + cooldown_period,
    });
    
    // Update user stake amount
    user_stake.staked_amount = user_stake.staked_amount.checked_sub(amount).unwrap();
    user_stake.update_tier();
    
    // Update pool totals
    stake_pool.total_staked = stake_pool.total_staked.checked_sub(amount).unwrap();
    
    msg!(
        "User {} initiated unstaking of {} tokens from pool {}. Cooldown until: {}",
        ctx.accounts.user.key(),
        amount,
        stake_pool.pool_id,
        current_time + cooldown_period
    );
    
    Ok(())
}
