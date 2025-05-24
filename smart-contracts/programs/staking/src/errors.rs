use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Invalid staking authority")]
    InvalidAuthority,
    
    #[msg("Staking is currently paused")]
    StakingPaused,
    
    #[msg("Invalid stake amount")]
    InvalidStakeAmount,
    
    #[msg("Insufficient staked balance")]
    InsufficientStakedBalance,
    
    #[msg("Unstaking cooldown period has not ended")]
    CooldownNotEnded,
    
    #[msg("No tokens are unstaking")]
    NothingToWithdraw,
    
    #[msg("No rewards available to claim")]
    NoRewardsToClaim,
    
    #[msg("Invalid stake pool configuration")]
    InvalidStakePoolConfig,
    
    #[msg("Stake pool is not active")]
    StakePoolNotActive,
    
    #[msg("Minimum stake amount not met")]
    MinimumStakeNotMet,
    
    #[msg("Maximum stake amount exceeded")]
    MaximumStakeExceeded,
    
    #[msg("Arithmetic overflow")]
    MathOverflow,
    
    #[msg("Invalid reward rate")]
    InvalidRewardRate,
    
    #[msg("Insufficient reward balance in pool")]
    InsufficientRewards,
    
    #[msg("Invalid staking duration")]
    InvalidStakingDuration,
    
    #[msg("Cannot withdraw before minimum staking period")]
    MinimumStakingPeriodNotMet,
    
    #[msg("Invalid tier configuration")]
    InvalidTierConfig,
    
    #[msg("Stake account already exists")]
    StakeAccountAlreadyExists,
    
    #[msg("Invalid calculation parameters")]
    InvalidCalculation,
}
