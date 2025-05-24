# Staking Program Documentation

**Location**: `tickettoken/contracts/programs/staking/src/lib.rs`  
**Program ID**: `Staking1111111111111111111111111111111111111111` (Replace with actual deployed address)  
**Purpose**: Provides token staking functionality with rewards, multiple pools, and tier-based bonuses for the TicketToken platform

## Overview

The Staking program enables users to stake TicketToken tokens in various pools to earn rewards and access platform benefits through:

- Multiple stake pools with different configurations
- Tier-based staking with reward multipliers (Bronze → Diamond)
- Cooldown periods for unstaking tokens
- Reward distribution and claiming mechanisms
- Event-specific staking pools
- Emergency pause functionality for security
- Integration with rewards program for bonus incentives

## Program Structure

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("Staking1111111111111111111111111111111111111111");

#[program]
pub mod ticket_staking {
    use super::*;

    /// Initialize the staking program
    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        config: StakingConfig,
    ) -> Result<()> { /* ... */ }

    /// Create a new stake pool
    pub fn create_stake_pool(
        ctx: Context<CreateStakePool>,
        pool_config: StakePoolConfig,
        pool_type: PoolType,
    ) -> Result<()> { /* ... */ }

    /// Stake tokens in a pool
    pub fn stake_tokens(
        ctx: Context<StakeTokens>,
        amount: u64,
    ) -> Result<()> { /* ... */ }

    /// Begin unstaking process (with cooldown)
    pub fn unstake_tokens(
        ctx: Context<UnstakeTokens>,
        amount: u64,
    ) -> Result<()> { /* ... */ }

    /// Withdraw unstaked tokens after cooldown
    pub fn withdraw_unstaked(
        ctx: Context<WithdrawUnstaked>,
    ) -> Result<()> { /* ... */ }

    /// Claim accumulated rewards
    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> { /* ... */ }

    /// Distribute rewards to a stake pool (admin only)
    pub fn distribute_rewards(
        ctx: Context<DistributeRewards>,
        amount: u64,
    ) -> Result<()> { /* ... */ }

    /// Update stake pool configuration (admin only)
    pub fn update_stake_pool(
        ctx: Context<UpdateStakePool>,
        new_config: StakePoolConfig,
    ) -> Result<()> { /* ... */ }

    /// Emergency pause/unpause staking (admin only)
    pub fn emergency_pause(
        ctx: Context<EmergencyPause>,
        paused: bool,
    ) -> Result<()> { /* ... */ }
}
```

## Account Structures

**Location**: `tickettoken/contracts/programs/staking/src/state/`

```rust
// Main staking program configuration
#[account]
pub struct StakingProgram {
    pub authority: Pubkey,           // Program authority
    pub config: StakingConfig,       // Global configuration
    pub active_pools: u32,           // Number of active pools
    pub total_staked: u64,           // Total staked across all pools
    pub bump: u8,                    // PDA bump seed
}

// Individual stake pool
#[account]
pub struct StakePool {
    pub staking_program: Pubkey,     // Parent staking program
    pub pool_id: u32,                // Unique pool identifier
    pub config: StakePoolConfig,     // Pool-specific config
    pub pool_type: PoolType,         // Type of pool
    pub stake_token_mint: Pubkey,    // Token to stake
    pub reward_token_mint: Pubkey,   // Reward token mint
    pub stake_vault: Pubkey,         // Vault holding staked tokens
    pub reward_vault: Pubkey,        // Vault holding reward tokens
    pub total_staked: u64,           // Total staked in this pool
    pub total_rewards_distributed: u64, // Total rewards distributed
    pub available_rewards: u64,      // Available reward balance
    pub staker_count: u32,           // Number of stakers
    pub accumulated_reward_per_token: u128, // Reward calculation
    pub associated_event: Option<Pubkey>, // Optional event association
    pub active: bool,                // Whether pool is active
    pub bump: u8,                    // PDA bump seed
}

// User's stake in a specific pool
#[account]
pub struct UserStake {
    pub stake_pool: Pubkey,          // Associated pool
    pub user: Pubkey,                // Staker's address
    pub staked_amount: u64,          // Amount currently staked
    pub initial_stake_time: i64,     // When first staked
    pub last_stake_time: i64,        // Last time tokens were added
    pub last_reward_time: i64,       // Last reward claim/calculation
    pub pending_rewards: u64,        // Unclaimed rewards
    pub total_rewards_claimed: u64,  // Total claimed rewards
    pub reward_per_token_paid: u128, // For reward calculation
    pub unstake_request: Option<UnstakeRequest>, // Pending unstake
    pub staking_tier: StakingTier,   // Current tier
    pub bump: u8,                    // PDA bump seed
}
```

## Configuration Structures

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct StakingConfig {
    pub default_cooldown_period: i64,    // Default unstaking cooldown (7 days)
    pub reward_claim_cooldown: i64,      // Cooldown between reward claims (1 day)
    pub early_unstake_fee_bps: u16,      // Early unstaking penalty (5%)
    pub max_stake_pools: u32,            // Maximum pools allowed (10)
    pub paused: bool,                    // Global pause state
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct StakePoolConfig {
    pub reward_rate_bps: u16,            // Annual reward rate (e.g., 1200 = 12% APY)
    pub min_stake_amount: u64,           // Minimum stake amount
    pub max_stake_amount: u64,           // Maximum stake per user
    pub cooldown_period: Option<i64>,    // Pool-specific cooldown
    pub min_staking_duration: i64,       // Minimum staking time
    pub accepting_stakes: bool,          // Whether accepting new stakes
    pub pool_capacity: u64,              // Total pool capacity (0 = unlimited)
    pub tier_bonus_enabled: bool,        // Whether tier bonuses apply
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct UnstakeRequest {
    pub amount: u64,                     // Amount being unstaked
    pub request_time: i64,               // When unstaking was initiated
    pub withdraw_time: i64,              // When tokens can be withdrawn
}
```

## Enums

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PoolType {
    General,            // General staking pool
    EventSpecific,      // Specific to event ticket holders  
    Vip,               // VIP pool with higher rewards
    LiquidityProvider, // Liquidity provider rewards
    Team,              // Developer/team staking
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StakingTier {
    Bronze,    // 0-9,999 tokens staked
    Silver,    // 10,000-49,999 tokens
    Gold,      // 50,000-99,999 tokens
    Platinum,  // 100,000-499,999 tokens
    Diamond,   // 500,000+ tokens
}
```

## Events

**Location**: `tickettoken/contracts/programs/staking/src/events.rs`

```rust
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
```

## Errors

**Location**: `tickettoken/contracts/programs/staking/src/errors.rs`

```rust
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
    
    // ... more error variants
}
```

## Usage Examples

### Initialize Staking Program

```typescript
const stakingConfig = {
  defaultCooldownPeriod: new BN(7 * 24 * 60 * 60), // 7 days
  rewardClaimCooldown: new BN(24 * 60 * 60), // 1 day
  earlyUnstakeFeeBps: 500, // 5% penalty
  maxStakePools: 10,
  paused: false,
};

await stakingProgram.methods
  .initializeStaking(stakingConfig)
  .accounts({
    stakingProgram: stakingProgramPDA,
    authority: authority.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

### Create a Stake Pool

```typescript
const poolConfig = {
  rewardRateBps: 1200, // 12% APY
  minStakeAmount: new BN(100 * 10**6), // 100 tokens minimum
  maxStakeAmount: new BN(1_000_000 * 10**6), // 1M tokens maximum
  cooldownPeriod: null, // Use default
  minStakingDuration: new BN(24 * 60 * 60), // 1 day minimum
  acceptingStakes: true,
  poolCapacity: new BN(0), // Unlimited
  tierBonusEnabled: true,
};

const poolType = { general: {} };

await stakingProgram.methods
  .createStakePool(poolConfig, poolType)
  .accounts({
    stakingProgram: stakingProgramPDA,
    stakePool: stakePoolPDA,
    stakeTokenMint: tokenMint.publicKey,
    rewardTokenMint: rewardTokenMint.publicKey,
    stakeVault: stakeVaultAccount,
    rewardVault: rewardVaultAccount,
    authority: authority.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([authority])
  .rpc();
```

### Stake Tokens

```typescript
const stakeAmount = new BN(1000 * 10**6); // 1000 tokens

await stakingProgram.methods
  .stakeTokens(stakeAmount)
  .accounts({
    stakingProgram: stakingProgramPDA,
    stakePool: stakePoolPDA,
    userStake: userStakePDA,
    userTokenAccount: userTokenAccount,
    stakeVault: stakeVaultAccount,
    user: user.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([user])
  .rpc();
```

### Unstake Tokens

```typescript
const unstakeAmount = new BN(500 * 10**6); // 500 tokens

await stakingProgram.methods
  .unstakeTokens(unstakeAmount)
  .accounts({
    stakingProgram: stakingProgramPDA,
    stakePool: stakePoolPDA,
    userStake: userStakePDA,
    user: user.publicKey,
  })
  .signers([user])
  .rpc();
```

### Claim Rewards

```typescript
await stakingProgram.methods
  .claimRewards()
  .accounts({
    stakingProgram: stakingProgramPDA,
    stakePool: stakePoolPDA,
    userStake: userStakePDA,
    userRewardAccount: userRewardTokenAccount,
    rewardVault: rewardVaultAccount,
    user: user.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([user])
  .rpc();
```

### Distribute Rewards (Admin)

```typescript
const rewardAmount = new BN(10000 * 10**6); // 10K tokens

await stakingProgram.methods
  .distributeRewards(rewardAmount)
  .accounts({
    stakingProgram: stakingProgramPDA,
    stakePool: stakePoolPDA,
    authorityRewardAccount: authorityRewardAccount,
    rewardVault: rewardVaultAccount,
    authority: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([authority])
  .rpc();
```

## Integration Points

### With Rewards Program
- **Staking Multipliers**: Higher staking tiers get reward multipliers in the rewards program
- **Reward Distribution**: Staking program can distribute rewards to boost user loyalty
- **Cross-Program Benefits**: Stakers get preferential treatment in reward campaigns

### With Governance Program  
- **Voting Power**: Staked tokens provide governance voting power
- **Proposal Requirements**: Minimum staking requirements for creating proposals
- **Governance Rewards**: Additional rewards for governance participation

### With Ticket Program
- **Event-Specific Pools**: Create pools tied to specific events or venues
- **VIP Benefits**: Higher tier stakers get priority ticket access
- **Ticket Holder Rewards**: Special staking pools for ticket NFT holders

## Staking Mechanics

### Reward Calculation
Rewards are calculated using the formula:
```
pending_rewards = staked_amount * (current_reward_per_token - user_reward_per_token_paid) / 1e12
```

### Tier System
- **Bronze** (0-9,999): 1.0x multiplier
- **Silver** (10,000-49,999): 1.1x multiplier  
- **Gold** (50,000-99,999): 1.25x multiplier
- **Platinum** (100,000-499,999): 1.5x multiplier
- **Diamond** (500,000+): 2.0x multiplier

### Pool Types
- **General**: Standard staking pools for all users
- **EventSpecific**: Pools tied to specific events for additional benefits
- **VIP**: High-reward pools with stricter requirements
- **LiquidityProvider**: Pools for market makers and liquidity providers
- **Team**: Special pools for team members and advisors

## Security Features

1. **Access Control**: Only authorized accounts can create pools and distribute rewards
2. **Cooldown Periods**: Prevent immediate unstaking to encourage long-term staking  
3. **Pause Functionality**: Emergency pause for security incidents
4. **Overflow Protection**: Safe arithmetic for all calculations
5. **PDA Verification**: Proper validation of all program derived addresses
6. **Tier Validation**: Automatic tier calculation and verification

## Testing

Tests are located in `tickettoken/contracts/tests/staking.ts`

```bash
cd tickettoken/contracts
anchor test -- --features staking
```

### Test Coverage
- ✅ Staking program initialization
- ✅ Stake pool creation and management  
- ✅ Token staking and unstaking flows
- ✅ Reward calculation and claiming
- ✅ Tier progression and benefits
- ✅ Cooldown period enforcement
- ✅ Access control and security
- ✅ Emergency pause functionality
- ✅ Event emission and tracking

## Deployment

### Environment Setup
```toml
# Anchor.toml
[programs.localnet]
staking = "Staking1111111111111111111111111111111111111111"

[programs.devnet]  
staking = "Staking1111111111111111111111111111111111111111"

[programs.mainnet]
staking = "Staking1111111111111111111111111111111111111111"
```

### Deployment Steps
1. Build the program: `anchor build`
2. Deploy to devnet: `anchor deploy --provider.cluster devnet`
3. Initialize the staking program with configuration
4. Create initial stake pools  
5. Integrate with rewards and governance programs
6. Conduct security audit
7. Deploy to mainnet

## Analytics and Monitoring

### Key Metrics
- Total value locked (TVL) across all pools
- Number of active stakers
- Average staking duration
- Tier distribution of stakers
- Reward distribution rates
- Pool utilization rates

### Pool Performance
- APY for each pool type
- Staker retention rates  
- Reward claim frequency
- Unstaking patterns
- Tier progression rates

## Future Enhancements

### Planned Features
1. **Auto-Compounding**: Automatic reward reinvestment
2. **Liquid Staking**: Tradeable staking derivatives
3. **Cross-Chain Staking**: Support for multiple blockchains
4. **Dynamic APY**: Algorithm-based reward rate adjustments
5. **Lock-up Periods**: Fixed-term staking with higher rewards
6. **Penalty Redistribution**: Redistribute early unstaking penalties

### Technical Improvements  
1. **Gas Optimization**: Reduce transaction costs
2. **Batch Operations**: Efficient bulk staking/unstaking
3. **Advanced Analytics**: Real-time staking insights
4. **Mobile Integration**: Mobile-specific staking features

## Conclusion

The Staking program provides a comprehensive token staking solution for the TicketToken platform, enabling users to earn rewards while participating in the ecosystem. With flexible pool configuration, tier-based benefits, and seamless integration with other platform components, it creates strong incentives for long-term token holding and platform engagement.

The system is designed to be scalable, secure, and adaptable to evolving platform needs while maintaining fairness and transparency in reward distribution.

---

**Related Documentation:**
- [Rewards Program](../rewards/README.md)
- [Governance Program](../governance/README.md)  
- [Main Contracts Documentation](../../README.md)
