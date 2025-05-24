use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;
use state::*;
use errors::*;

declare_id!("Staking1111111111111111111111111111111111111111");

#[program]
pub mod ticket_staking {
    use super::*;

    /// Initialize the staking program
    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        config: StakingConfig,
    ) -> Result<()> {
        instructions::initialize_staking::handler(ctx, config)
    }

    /// Create a new stake pool
    pub fn create_stake_pool(
        ctx: Context<CreateStakePool>,
        pool_config: StakePoolConfig,
        pool_type: PoolType,
    ) -> Result<()> {
        instructions::create_stake_pool::handler(ctx, pool_config, pool_type)
    }

    /// Stake tokens in a pool
    pub fn stake_tokens(
        ctx: Context<StakeTokens>,
        amount: u64,
    ) -> Result<()> {
        instructions::stake_tokens::handler(ctx, amount)
    }

    /// Begin unstaking process (with cooldown)
    pub fn unstake_tokens(
        ctx: Context<UnstakeTokens>,
        amount: u64,
    ) -> Result<()> {
        instructions::unstake_tokens::handler(ctx, amount)
    }

    /// Withdraw unstaked tokens after cooldown
    pub fn withdraw_unstaked(
        ctx: Context<WithdrawUnstaked>,
    ) -> Result<()> {
        instructions::withdraw_unstaked::handler(ctx)
    }

    /// Claim accumulated rewards
    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> {
        instructions::claim_rewards::handler(ctx)
    }

    /// Distribute rewards to a stake pool (admin only)
    pub fn distribute_rewards(
        ctx: Context<DistributeRewards>,
        amount: u64,
    ) -> Result<()> {
        instructions::distribute_rewards::handler(ctx, amount)
    }

    /// Update stake pool configuration (admin only)
    pub fn update_stake_pool(
        ctx: Context<UpdateStakePool>,
        new_config: StakePoolConfig,
    ) -> Result<()> {
        instructions::update_stake_pool::handler(ctx, new_config)
    }

    /// Emergency pause/unpause staking (admin only)
    pub fn emergency_pause(
        ctx: Context<EmergencyPause>,
        paused: bool,
    ) -> Result<()> {
        instructions::emergency_pause::handler(ctx, paused)
    }
}
