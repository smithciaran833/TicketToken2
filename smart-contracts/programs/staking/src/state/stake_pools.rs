use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct StakePoolConfig {
    /// Annual reward rate in basis points (e.g., 1200 = 12% APY)
    pub reward_rate_bps: u16,
    
    /// Minimum amount required to stake
    pub min_stake_amount: u64,
    
    /// Maximum amount that can be staked per user
    pub max_stake_amount: u64,
    
    /// Cooldown period specific to this pool (overrides default if set)
    pub cooldown_period: Option<i64>,
    
    /// Minimum time tokens must be staked before unstaking
    pub min_staking_duration: i64,
    
    /// Whether this pool is currently accepting new stakes
    pub accepting_stakes: bool,
    
    /// Pool capacity (0 = unlimited)
    pub pool_capacity: u64,
    
    /// Whether staking tiers provide bonus rewards
    pub tier_bonus_enabled: bool,
}

impl Default for StakePoolConfig {
    fn default() -> Self {
        Self {
            reward_rate_bps: 1200, // 12% APY
            min_stake_amount: 100 * 10_u64.pow(6), // 100 tokens
            max_stake_amount: 1_000_000 * 10_u64.pow(6), // 1M tokens
            cooldown_period: None,
            min_staking_duration: 24 * 60 * 60, // 1 day
            accepting_stakes: true,
            pool_capacity: 0, // Unlimited
            tier_bonus_enabled: true,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PoolType {
    /// General staking pool for governance tokens
    General,
    /// Specific to event ticket holders
    EventSpecific,
    /// VIP pool with higher rewards but stricter requirements
    Vip,
    /// Liquidity provider rewards pool
    LiquidityProvider,
    /// Developer/team staking pool
    Team,
}

#[account]
pub struct StakePool {
    /// The staking program this pool belongs to
    pub staking_program: Pubkey,
    
    /// Pool identifier (incremental)
    pub pool_id: u32,
    
    /// Pool configuration
    pub config: StakePoolConfig,
    
    /// Type of pool
    pub pool_type: PoolType,
    
    /// Token mint for staking
    pub stake_token_mint: Pubkey,
    
    /// Token mint for rewards (can be same as stake token)
    pub reward_token_mint: Pubkey,
    
    /// Vault holding staked tokens
    pub stake_vault: Pubkey,
    
    /// Vault holding reward tokens
    pub reward_vault: Pubkey,
    
    /// Authority that can update pool settings
    pub pool_authority: Pubkey,
    
    /// Total amount of tokens staked in this pool
    pub total_staked: u64,
    
    /// Total rewards distributed by this pool
    pub total_rewards_distributed: u64,
    
    /// Current available reward balance
    pub available_rewards: u64,
    
    /// Number of unique stakers in this pool
    pub staker_count: u32,
    
    /// Last time rewards were updated/distributed
    pub last_update_time: i64,
    
    /// Accumulated reward per token (scaled by 1e12 for precision)
    pub accumulated_reward_per_token: u128,
    
    /// When the pool was created
    pub created_at: i64,
    
    /// Optional: Associated event for event-specific pools
    pub associated_event: Option<Pubkey>,
    
    /// Whether the pool is currently active
    pub active: bool,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl StakePool {
    pub const LEN: usize = 8 + // discriminator
        32 + // staking_program
        4 + // pool_id
        (2 + 8 + 8 + 9 + 8 + 1 + 8 + 1) + // config
        1 + // pool_type
        32 + // stake_token_mint
        32 + // reward_token_mint
        32 + // stake_vault
        32 + // reward_vault
        32 + // pool_authority
        8 + // total_staked
        8 + // total_rewards_distributed
        8 + // available_rewards
        4 + // staker_count
        8 + // last_update_time
        16 + // accumulated_reward_per_token
        8 + // created_at
        (1 + 32) + // associated_event
        1 + // active
        1; // bump
    
    /// Calculate current reward per token
    pub fn calculate_reward_per_token(&self, current_time: i64) -> Result<u128> {
        if self.total_staked == 0 {
            return Ok(self.accumulated_reward_per_token);
        }
        
        let time_elapsed = current_time - self.last_update_time;
        let annual_seconds = 365 * 24 * 60 * 60;
        
        // Calculate reward rate per second
        let reward_per_second = (self.config.reward_rate_bps as u128)
            .checked_mul(self.total_staked as u128)
            .unwrap()
            .checked_div(10000) // Convert from basis points
            .unwrap()
            .checked_div(annual_seconds as u128)
            .unwrap();
        
        // Calculate additional reward per token
        let additional_reward_per_token = reward_per_second
            .checked_mul(time_elapsed as u128)
            .unwrap()
            .checked_mul(1_000_000_000_000) // Scale by 1e12 for precision
            .unwrap()
            .checked_div(self.total_staked as u128)
            .unwrap();
        
        self.accumulated_reward_per_token
            .checked_add(additional_reward_per_token)
            .ok_or(anchor_lang::error::ErrorCode::AccountDidNotSerialize.into())
    }
    
    /// Update the accumulated reward per token
    pub fn update_rewards(&mut self, current_time: i64) -> Result<()> {
        self.accumulated_reward_per_token = self.calculate_reward_per_token(current_time)?;
        self.last_update_time = current_time;
        Ok(())
    }
    
    /// Check if the pool has capacity for additional stakes
    pub fn has_capacity(&self, additional_amount: u64) -> bool {
        if self.config.pool_capacity == 0 {
            return true; // Unlimited capacity
        }
        
        self.total_staked + additional_amount <= self.config.pool_capacity
    }
}
