use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint, Token};

use crate::state::{StakingProgram, StakePool, StakePoolConfig, PoolType};
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(pool_config: StakePoolConfig, pool_type: PoolType)]
pub struct CreateStakePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The staking program account
    #[account(
        mut,
        seeds = [b"staking_program"],
        bump = staking_program.bump,
        constraint = staking_program.authority == authority.key() @ StakingError::InvalidAuthority
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// Token mint for staking
    pub stake_token_mint: Account<'info, Mint>,
    
    /// Token mint for rewards (can be same as stake token)
    pub reward_token_mint: Account<'info, Mint>,
    
    /// Vault to hold staked tokens
    #[account(
        init,
        payer = authority,
        token::mint = stake_token_mint,
        token::authority = stake_pool,
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    /// Vault to hold reward tokens
    #[account(
        init,
        payer = authority,
        token::mint = reward_token_mint,
        token::authority = stake_pool,
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    /// The stake pool account to be created
    #[account(
        init,
        payer = authority,
        space = StakePool::LEN,
        seeds = [b"stake_pool", staking_program.key().as_ref(), &staking_program.active_pools.to_le_bytes()],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,
    
    /// Optional: Associated event for event-specific pools
    pub associated_event: Option<AccountInfo<'info>>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateStakePool>,
    pool_config: StakePoolConfig,
    pool_type: PoolType,
) -> Result<()> {
    let staking_program = &mut ctx.accounts.staking_program;
    let stake_pool = &mut ctx.accounts.stake_pool;
    
    // Check if we've reached the maximum number of pools
    require!(
        staking_program.active_pools < staking_program.config.max_stake_pools,
        StakingError::InvalidStakePoolConfig
    );
    
    // Validate pool configuration
    require!(
        pool_config.reward_rate_bps <= 10000, // Max 100% APY
        StakingError::InvalidRewardRate
    );
    require!(
        pool_config.min_stake_amount <= pool_config.max_stake_amount,
        StakingError::InvalidStakePoolConfig
    );
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Initialize stake pool
    stake_pool.staking_program = staking_program.key();
    stake_pool.pool_id = staking_program.active_pools;
    stake_pool.config = pool_config;
    stake_pool.pool_type = pool_type;
    stake_pool.stake_token_mint = ctx.accounts.stake_token_mint.key();
    stake_pool.reward_token_mint = ctx.accounts.reward_token_mint.key();
    stake_pool.stake_vault = ctx.accounts.stake_vault.key();
    stake_pool.reward_vault = ctx.accounts.reward_vault.key();
    stake_pool.pool_authority = ctx.accounts.authority.key();
    stake_pool.total_staked = 0;
    stake_pool.total_rewards_distributed = 0;
    stake_pool.available_rewards = 0;
    stake_pool.staker_count = 0;
    stake_pool.last_update_time = current_time;
    stake_pool.accumulated_reward_per_token = 0;
    stake_pool.created_at = current_time;
    stake_pool.associated_event = ctx.accounts.associated_event.map(|e| e.key());
    stake_pool.active = true;
    stake_pool.bump = *ctx.bumps.get("stake_pool").unwrap();
    
    // Increment active pools count
    staking_program.active_pools += 1;
    
    msg!(
        "Stake pool {} created: {:?} type, {}% APY",
        stake_pool.pool_id,
        pool_type,
        pool_config.reward_rate_bps as f64 / 100.0
    );
    
    Ok(())
}
