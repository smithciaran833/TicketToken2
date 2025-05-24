use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct StakingConfig {
    /// Default cooldown period for unstaking (in seconds)
    pub default_cooldown_period: i64,
    
    /// Minimum time that must pass between claiming rewards
    pub reward_claim_cooldown: i64,
    
    /// Fee for early unstaking (in basis points)
    pub early_unstake_fee_bps: u16,
    
    /// Maximum number of stake pools allowed
    pub max_stake_pools: u32,
    
    /// Whether staking is globally paused
    pub paused: bool,
}

impl Default for StakingConfig {
    fn default() -> Self {
        Self {
            default_cooldown_period: 7 * 24 * 60 * 60, // 7 days
            reward_claim_cooldown: 24 * 60 * 60, // 1 day
            early_unstake_fee_bps: 500, // 5% penalty
            max_stake_pools: 10,
            paused: false,
        }
    }
}

#[account]
pub struct StakingProgram {
    /// Authority that can update staking configuration
    pub authority: Pubkey,
    
    /// Current staking configuration
    pub config: StakingConfig,
    
    /// Total number of active stake pools
    pub active_pools: u32,
    
    /// Total amount of tokens staked across all pools
    pub total_staked: u64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl StakingProgram {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        (8 + 8 + 2 + 4 + 1) + // config
        4 + // active_pools
        8 + // total_staked
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StakingTier {
    Bronze,
    Silver,
    Gold,
    Platinum,
    Diamond,
}

impl StakingTier {
    pub fn from_amount(amount: u64) -> Self {
        match amount {
            0..=9_999 => StakingTier::Bronze,
            10_000..=49_999 => StakingTier::Silver,
            50_000..=99_999 => StakingTier::Gold,
            100_000..=499_999 => StakingTier::Platinum,
            _ => StakingTier::Diamond,
        }
    }
    
    pub fn multiplier(&self) -> u64 {
        match self {
            StakingTier::Bronze => 100, // 1.0x
            StakingTier::Silver => 110, // 1.1x
            StakingTier::Gold => 125, // 1.25x
            StakingTier::Platinum => 150, // 1.5x
            StakingTier::Diamond => 200, // 2.0x
        }
    }
}
