use anchor_lang::prelude::*;
use crate::state::{PoolType, StakingTier};

#[event]
pub struct StakingInitialized {
    pub authority: Pubkey,
    pub default_cooldown_period: i64,
    pub max_stake_pools: u32,
}

#[event]
pub struct StakePoolCreated {
    pub pool_id: u32,
    pub pool_type: PoolType,
    pub stake_token_mint: Pubkey,
    pub reward_token_mint: Pubkey,
    pub reward_rate_bps: u16,
    pub authority: Pubkey,
}

#[event]
pub struct TokensStaked {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
    pub new_total_staked: u64,
    pub tier: StakingTier,
}

#[event]
pub struct UnstakeInitiated {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
    pub withdraw_time: i64,
}

#[event]
pub struct TokensWithdrawn {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
    pub tier: StakingTier,
}

#[event]
pub struct RewardsDistributed {
    pub pool_id: u32,
    pub amount: u64,
    pub distributor: Pubkey,
}

#[event]
pub struct StakePoolUpdated {
    pub pool_id: u32,
    pub new_reward_rate_bps: u16,
    pub updated_by: Pubkey,
}

#[event]
pub struct EmergencyPauseToggled {
    pub paused: bool,
    pub authority: Pubkey,
}
