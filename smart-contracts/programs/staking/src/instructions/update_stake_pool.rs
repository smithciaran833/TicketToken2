use anchor_lang::prelude::*;

use crate::state::{StakingProgram, StakePool, StakePoolConfig};
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(new_config: StakePoolConfig)]
pub struct UpdateStakePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The staking program account
    #[account(
        seeds = [b"staking_program"],
        bump = staking_program.bump,
        constraint = staking_program.authority == authority.key() @ StakingError::InvalidAuthority
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// The stake pool to update
    #[account(
        mut,
        constraint = stake_pool.pool_authority == authority.key() || staking_program.authority == authority.key() @ StakingError::InvalidAuthority
    )]
    pub stake_pool: Account<'info, StakePool>,
}

pub fn handler(ctx: Context<UpdateStakePool>, new_config: StakePoolConfig) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    
    // Validate new configuration
    require!(
        new_config.reward_rate_bps <= 10000, // Max 100% APY
        StakingError::InvalidRewardRate
    );
    require!(
        new_config.min_stake_amount <= new_config.max_stake_amount,
        StakingError::InvalidStakePoolConfig
    );
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Update pool rewards before changing configuration
    stake_pool.update_rewards(current_time)?;
    
    // Update configuration
    stake_pool.config = new_config;
    
    msg!(
        "Updated configuration for pool {}",
        stake_pool.pool_id
    );
    
    Ok(())
}
