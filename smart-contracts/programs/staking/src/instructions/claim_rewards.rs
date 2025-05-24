use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Token};

use crate::state::{StakingProgram, StakePool, UserStake};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The staking program account
    #[account(
        seeds = [b"staking_program"],
        bump = staking_program.bump
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// The stake pool
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
        constraint = user_stake.user == user.key()
    )]
    pub user_stake: Account<'info, UserStake>,
    
    /// User's token account (destination for reward tokens)
    #[account(
        mut,
        constraint = user_reward_account.mint == stake_pool.reward_token_mint,
        constraint = user_reward_account.owner == user.key()
    )]
    pub user_reward_account: Account<'info, TokenAccount>,
    
    /// Vault holding reward tokens
    #[account(
        mut,
        constraint = reward_vault.key() == stake_pool.reward_vault
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let staking_program = &ctx.accounts.staking_program;
    let stake_pool = &mut ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check reward claim cooldown
    let time_since_last_claim = current_time - user_stake.last_reward_time;
    require!(
        time_since_last_claim >= staking_program.config.reward_claim_cooldown,
        StakingError::InvalidCalculation
    );
    
    // Update pool rewards
    stake_pool.update_rewards(current_time)?;
    
    // Calculate total rewards
    let pending_rewards = user_stake.calculate_pending_rewards(stake_pool.accumulated_reward_per_token)?;
    
    require!(pending_rewards > 0, StakingError::NoRewardsToClaim);
    require!(
        stake_pool.available_rewards >= pending_rewards,
        StakingError::InsufficientRewards
    );
    
    // Create PDA signer for stake pool authority
    let staking_program_key = stake_pool.staking_program;
    let pool_id_bytes = stake_pool.pool_id.to_le_bytes();
    let seeds = &[
        b"stake_pool",
        staking_program_key.as_ref(),
        &pool_id_bytes,
        &[stake_pool.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Transfer reward tokens to user
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.reward_vault.to_account_info(),
        to: ctx.accounts.user_reward_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, pending_rewards)?;
    
    // Update state
    user_stake.pending_rewards = 0;
    user_stake.total_rewards_claimed = user_stake.total_rewards_claimed
        .checked_add(pending_rewards)
        .unwrap();
    user_stake.last_reward_time = current_time;
    user_stake.reward_per_token_paid = stake_pool.accumulated_reward_per_token;
    
    stake_pool.available_rewards = stake_pool.available_rewards
        .checked_sub(pending_rewards)
        .unwrap();
    stake_pool.total_rewards_distributed = stake_pool.total_rewards_distributed
        .checked_add(pending_rewards)
        .unwrap();
    
    msg!(
        "User {} claimed {} rewards from pool {}",
        ctx.accounts.user.key(),
        pending_rewards,
        stake_pool.pool_id
    );
    
    Ok(())
}
