use anchor_lang::prelude::*;
use crate::state::{StakingTier};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct UnstakeRequest {
    /// Amount being unstaked
    pub amount: u64,
    
    /// When the unstaking was initiated
    pub request_time: i64,
    
    /// When the tokens can be withdrawn
    pub withdraw_time: i64,
}

#[account]
pub struct UserStake {
    /// The stake pool this stake belongs to
    pub stake_pool: Pubkey,
    
    /// The user who owns this stake
    pub user: Pubkey,
    
    /// Amount currently staked
    pub staked_amount: u64,
    
    /// When the user first staked in this pool
    pub initial_stake_time: i64,
    
    /// Last time the user staked additional tokens
    pub last_stake_time: i64,
    
    /// Last time rewards were claimed or calculated
    pub last_reward_time: i64,
    
    /// Accumulated rewards (calculated but not yet claimed)
    pub pending_rewards: u64,
    
    /// Total rewards claimed by this user from this pool
    pub total_rewards_claimed: u64,
    
    /// User's reward per token paid (for reward calculation)
    pub reward_per_token_paid: u128,
    
    /// Current unstaking request (if any)
    pub unstake_request: Option<UnstakeRequest>,
    
    /// Current staking tier based on staked amount
    pub staking_tier: StakingTier,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl UserStake {
    pub const LEN: usize = 8 + // discriminator
        32 + // stake_pool
        32 + // user
        8 + // staked_amount
        8 + // initial_stake_time
        8 + // last_stake_time
        8 + // last_reward_time
        8 + // pending_rewards
        8 + // total_rewards_claimed
        16 + // reward_per_token_paid
        (1 + 8 + 8 + 8) + // unstake_request (Option<UnstakeRequest>)
        1 + // staking_tier
        1; // bump
    
    /// Calculate pending rewards for this user
    pub fn calculate_pending_rewards(&self, current_reward_per_token: u128) -> Result<u64> {
        let reward_per_token_diff = current_reward_per_token
            .checked_sub(self.reward_per_token_paid)
            .unwrap_or(0);
        
        let earned_rewards = (self.staked_amount as u128)
            .checked_mul(reward_per_token_diff)
            .unwrap()
            .checked_div(1_000_000_000_000) // Scale down from 1e12
            .unwrap() as u64;
        
        // Apply tier bonus if applicable
        let tier_multiplier = self.staking_tier.multiplier();
        let bonus_rewards = earned_rewards
            .checked_mul(tier_multiplier)
            .unwrap()
            .checked_div(100)
            .unwrap()
            .checked_sub(earned_rewards)
            .unwrap_or(0);
        
        self.pending_rewards
            .checked_add(earned_rewards)
            .unwrap()
            .checked_add(bonus_rewards)
            .ok_or(anchor_lang::error::ErrorCode::AccountDidNotSerialize.into())
    }
    
    /// Update the staking tier based on current staked amount
    pub fn update_tier(&mut self) {
        self.staking_tier = StakingTier::from_amount(self.staked_amount);
    }
    
    /// Check if user can unstake (minimum staking duration met)
    pub fn can_unstake(&self, current_time: i64, min_duration: i64) -> bool {
        current_time >= self.last_stake_time + min_duration
    }
    
    /// Check if unstaked tokens can be withdrawn
    pub fn can_withdraw_unstaked(&self, current_time: i64) -> bool {
        if let Some(unstake_request) = &self.unstake_request {
            current_time >= unstake_request.withdraw_time
        } else {
            false
        }
    }
    
    /// Get the amount available for withdrawal
    pub fn withdrawable_amount(&self, current_time: i64) -> u64 {
        if self.can_withdraw_unstaked(current_time) {
            self.unstake_request.map(|req| req.amount).unwrap_or(0)
        } else {
            0
        }
    }
}
