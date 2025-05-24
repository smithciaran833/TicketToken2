# Rewards Program Documentation

**Location**: `tickettoken/contracts/programs/rewards/src/lib.rs`
**Program ID**: `Rewards...` (Replace with actual deployed address)
**Purpose**: Manages reward distribution, loyalty programs, and incentive mechanisms for the TicketToken platform

## Overview

The Rewards program provides comprehensive incentive mechanisms for the TicketToken ecosystem through:
- Token-based reward distribution
- Multi-tier loyalty programs
- Event attendance rewards
- Staking yield distribution
- Community engagement incentives
- Dynamic reward multipliers
- Cross-program reward integration

## Program Structure

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Rewards...");

#[program]
pub mod rewards {
    use super::*;

    /// Initialize the rewards system
    pub fn initialize_rewards(
        ctx: Context<InitializeRewards>,
        config: RewardsConfig,
    ) -> Result<()> {
        let rewards_pool = &mut ctx.accounts.rewards_pool;
        
        rewards_pool.authority = ctx.accounts.authority.key();
        rewards_pool.reward_token_mint = ctx.accounts.reward_token_mint.key();
        rewards_pool.config = config;
        rewards_pool.total_distributed = 0;
        rewards_pool.total_claimed = 0;
        rewards_pool.active_campaigns = 0;
        rewards_pool.created_at = Clock::get()?.unix_timestamp;
        rewards_pool.bump = *ctx.bumps.get("rewards_pool").unwrap();
        
        emit!(RewardsInitialized {
            rewards_pool: rewards_pool.key(),
            authority: rewards_pool.authority,
            reward_token: rewards_pool.reward_token_mint,
            config: rewards_pool.config,
        });
        
        Ok(())
    }

    /// Create a new reward campaign
    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_type: CampaignType,
        name: String,
        description: String,
        reward_amount: u64,
        total_budget: u64,
        start_time: i64,
        end_time: i64,
        eligibility_criteria: EligibilityCriteria,
    ) -> Result<()> {
        let rewards_pool = &mut ctx.accounts.rewards_pool;
        let campaign = &mut ctx.accounts.campaign;
        
        // Validate campaign parameters
        require!(
            start_time < end_time,
            RewardsError::InvalidCampaignDuration
        );
        
        require!(
            total_budget > 0 && reward_amount > 0,
            RewardsError::InvalidRewardAmount
        );
        
        require!(
            total_budget >= reward_amount,
            RewardsError::InsufficientCampaignBudget
        );
        
        // Calculate max participants
        let max_participants = total_budget / reward_amount;
        
        rewards_pool.active_campaigns += 1;
        
        campaign.rewards_pool = rewards_pool.key();
        campaign.campaign_type = campaign_type;
        campaign.name = name;
        campaign.description = description;
        campaign.reward_amount = reward_amount;
        campaign.total_budget = total_budget;
        campaign.remaining_budget = total_budget;
        campaign.max_participants = max_participants;
        campaign.current_participants = 0;
        campaign.start_time = start_time;
        campaign.end_time = end_time;
        campaign.eligibility_criteria = eligibility_criteria;
        campaign.status = CampaignStatus::Active;
        campaign.created_at = Clock::get()?.unix_timestamp;
        campaign.bump = *ctx.bumps.get("campaign").unwrap();
        
        emit!(CampaignCreated {
            campaign: campaign.key(),
            campaign_type: campaign.campaign_type,
            name: campaign.name.clone(),
            reward_amount: campaign.reward_amount,
            total_budget: campaign.total_budget,
            max_participants: campaign.max_participants,
        });
        
        Ok(())
    }

    /// Earn rewards based on user actions
    pub fn earn_rewards(
        ctx: Context<EarnRewards>,
        action_type: ActionType,
        metadata: Vec<u8>,
    ) -> Result<()> {
        let user_rewards = &mut ctx.accounts.user_rewards;
        let campaign = &ctx.accounts.campaign;
        let rewards_pool = &ctx.accounts.rewards_pool;
        
        // Validate campaign is active
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            campaign.status == CampaignStatus::Active &&
            current_time >= campaign.start_time &&
            current_time <= campaign.end_time,
            RewardsError::CampaignNotActive
        );
        
        // Check if user is eligible
        require!(
            Self::check_eligibility(&campaign.eligibility_criteria, &ctx.accounts.user, &metadata)?,
            RewardsError::UserNotEligible
        );
        
        // Check if campaign has budget remaining
        require!(
            campaign.remaining_budget >= campaign.reward_amount,
            RewardsError::CampaignBudgetExhausted
        );
        
        // Check if user hasn't already participated (if single participation)
        if campaign.eligibility_criteria.single_participation {
            require!(
                !Self::has_user_participated(campaign.key(), ctx.accounts.user.key())?,
                RewardsError::UserAlreadyParticipated
            );
        }
        
        // Calculate reward multiplier
        let multiplier = Self::calculate_multiplier(&action_type, &user_rewards.loyalty_tier)?;
        let final_reward = (campaign.reward_amount as u128)
            .checked_mul(multiplier as u128)
            .and_then(|x| x.checked_div(10000))
            .and_then(|x| u64::try_from(x).ok())
            .ok_or(RewardsError::RewardCalculationOverflow)?;
        
        // Create reward entry
        let reward_entry = RewardEntry {
            campaign: campaign.key(),
            action_type,
            amount: final_reward,
            timestamp: current_time,
            claimed: false,
            metadata,
        };
        
        // Initialize user rewards if first time
        if user_rewards.user == Pubkey::default() {
            user_rewards.user = ctx.accounts.user.key();
            user_rewards.total_earned = 0;
            user_rewards.total_claimed = 0;
            user_rewards.loyalty_tier = LoyaltyTier::Bronze;
            user_rewards.loyalty_points = 0;
            user_rewards.reward_entries = Vec::new();
            user_rewards.created_at = current_time;
            user_rewards.bump = *ctx.bumps.get("user_rewards").unwrap();
        }
        
        // Add reward entry
        user_rewards.reward_entries.push(reward_entry);
        user_rewards.total_earned += final_reward;
        user_rewards.loyalty_points += Self::calculate_loyalty_points(&action_type, final_reward);
        
        // Update loyalty tier if needed
        user_rewards.loyalty_tier = Self::calculate_loyalty_tier(user_rewards.loyalty_points);
        
        emit!(RewardsEarned {
            user: ctx.accounts.user.key(),
            campaign: campaign.key(),
            action_type,
            reward_amount: final_reward,
            loyalty_points: user_rewards.loyalty_points,
            loyalty_tier: user_rewards.loyalty_tier,
        });
        
        Ok(())
    }

    /// Claim accumulated rewards
    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
        campaign_ids: Vec<Pubkey>,
    ) -> Result<()> {
        let user_rewards = &mut ctx.accounts.user_rewards;
        let rewards_pool = &mut ctx.accounts.rewards_pool;
        
        let mut total_claim_amount = 0u64;
        let mut claimed_count = 0usize;
        
        // Calculate total claimable amount
        for reward_entry in user_rewards.reward_entries.iter_mut() {
            if !reward_entry.claimed && 
               (campaign_ids.is_empty() || campaign_ids.contains(&reward_entry.campaign)) {
                total_claim_amount = total_claim_amount
                    .checked_add(reward_entry.amount)
                    .ok_or(RewardsError::ClaimAmountOverflow)?;
                reward_entry.claimed = true;
                claimed_count += 1;
            }
        }
        
        require!(total_claim_amount > 0, RewardsError::NoRewardsToClaim);
        
        // Verify sufficient balance in rewards vault
        require!(
            ctx.accounts.rewards_vault.amount >= total_claim_amount,
            RewardsError::InsufficientRewardsVault
        );
        
        // Transfer rewards to user
        let seeds = &[
            b"rewards_pool",
            &[rewards_pool.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.rewards_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: rewards_pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, total_claim_amount)?;
        
        // Update tracking
        user_rewards.total_claimed += total_claim_amount;
        rewards_pool.total_claimed += total_claim_amount;
        
        emit!(RewardsClaimed {
            user: ctx.accounts.user.key(),
            amount: total_claim_amount,
            campaigns_count: claimed_count as u32,
            new_total_claimed: user_rewards.total_claimed,
        });
        
        Ok(())
    }

    /// Distribute staking rewards
    pub fn distribute_staking_rewards(
        ctx: Context<DistributeStakingRewards>,
        total_amount: u64,
        stakers: Vec<StakerReward>,
    ) -> Result<()> {
        let rewards_pool = &mut ctx.accounts.rewards_pool;
        
        // Verify caller is authorized (staking program or governance)
        require!(
            ctx.accounts.authority.key() == rewards_pool.authority ||
            Self::is_authorized_distributor(&ctx.accounts.authority.key())?,
            RewardsError::UnauthorizedDistribution
        );
        
        // Verify total amount matches sum of individual rewards
        let calculated_total: u64 = stakers.iter().map(|s| s.amount).sum();
        require!(
            calculated_total == total_amount,
            RewardsError::DistributionAmountMismatch
        );
        
        // Verify sufficient vault balance
        require!(
            ctx.accounts.rewards_vault.amount >= total_amount,
            RewardsError::InsufficientRewardsVault
        );
        
        // Process each staker reward
        for (index, staker_reward) in stakers.iter().enumerate() {
            let staker_account = &ctx.remaining_accounts[index];
            
            // Transfer to staker
            let seeds = &[
                b"rewards_pool",
                &[rewards_pool.bump],
            ];
            let signer = &[&seeds[..]];
            
            let cpi_accounts = token::Transfer {
                from: ctx.accounts.rewards_vault.to_account_info(),
                to: staker_account.to_account_info(),
                authority: rewards_pool.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, staker_reward.amount)?;
        }
        
        rewards_pool.total_distributed += total_amount;
        
        emit!(StakingRewardsDistributed {
            total_amount,
            stakers_count: stakers.len() as u32,
            distribution_round: rewards_pool.total_distributed,
        });
        
        Ok(())
    }

    /// Update loyalty tier manually (admin function)
    pub fn update_loyalty_tier(
        ctx: Context<UpdateLoyaltyTier>,
        new_tier: LoyaltyTier,
    ) -> Result<()> {
        let user_rewards = &mut ctx.accounts.user_rewards;
        let rewards_pool = &ctx.accounts.rewards_pool;
        
        // Only authority can manually update tiers
        require!(
            ctx.accounts.authority.key() == rewards_pool.authority,
            RewardsError::UnauthorizedTierUpdate
        );
        
        let old_tier = user_rewards.loyalty_tier;
        user_rewards.loyalty_tier = new_tier;
        
        emit!(LoyaltyTierUpdated {
            user: user_rewards.user,
            old_tier,
            new_tier,
            updated_by: ctx.accounts.authority.key(),
        });
        
        Ok(())
    }

    /// End a campaign early
    pub fn end_campaign(
        ctx: Context<EndCampaign>,
        reason: String,
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let rewards_pool = &mut ctx.accounts.rewards_pool;
        
        // Only authority can end campaigns
        require!(
            ctx.accounts.authority.key() == rewards_pool.authority,
            RewardsError::UnauthorizedCampaignEnd
        );
        
        // Can only end active campaigns
        require!(
            campaign.status == CampaignStatus::Active,
            RewardsError::CampaignNotActive
        );
        
        campaign.status = CampaignStatus::Ended;
        campaign.ended_at = Some(Clock::get()?.unix_timestamp);
        campaign.end_reason = Some(reason.clone());
        
        rewards_pool.active_campaigns -= 1;
        
        emit!(CampaignEnded {
            campaign: campaign.key(),
            reason,
            remaining_budget: campaign.remaining_budget,
            participants: campaign.current_participants,
        });
        
        Ok(())
    }

    /// Deposit rewards into the vault
    pub fn deposit_rewards(
        ctx: Context<DepositRewards>,
        amount: u64,
    ) -> Result<()> {
        // Transfer tokens from depositor to rewards vault
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.rewards_vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(RewardsDeposited {
            depositor: ctx.accounts.depositor.key(),
            amount,
            new_vault_balance: ctx.accounts.rewards_vault.amount + amount,
        });
        
        Ok(())
    }
}

// Helper implementation
impl rewards {
    fn check_eligibility(
        criteria: &EligibilityCriteria,
        user: &AccountInfo,
        metadata: &[u8],
    ) -> Result<bool> {
        // Implementation would check various eligibility conditions
        // Based on user's history, holdings, activity, etc.
        Ok(true) // Simplified for now
    }
    
    fn has_user_participated(
        campaign_key: Pubkey,
        user_key: Pubkey,
    ) -> Result<bool> {
        // Implementation would check if user has already participated
        // This might involve checking existing reward entries
        Ok(false) // Simplified for now
    }
    
    fn calculate_multiplier(
        action_type: &ActionType,
        loyalty_tier: &LoyaltyTier,
    ) -> Result<u16> {
        let base_multiplier = match action_type {
            ActionType::TicketPurchase => 10000, // 1.0x
            ActionType::EventAttendance => 15000, // 1.5x
            ActionType::Referral => 20000, // 2.0x
            ActionType::Staking => 12000, // 1.2x
            ActionType::GovernanceVote => 11000, // 1.1x
            ActionType::SocialShare => 5000, // 0.5x
            ActionType::ProfileCompletion => 8000, // 0.8x
            ActionType::Custom => 10000, // 1.0x
        };
        
        let tier_multiplier = match loyalty_tier {
            LoyaltyTier::Bronze => 10000, // 1.0x
            LoyaltyTier::Silver => 11000, // 1.1x
            LoyaltyTier::Gold => 12500, // 1.25x
            LoyaltyTier::Platinum => 15000, // 1.5x
            LoyaltyTier::Diamond => 20000, // 2.0x
        };
        
        // Combine multipliers (both are in basis points, so divide by 10000)
        let final_multiplier = (base_multiplier as u128)
            .checked_mul(tier_multiplier as u128)
            .and_then(|x| x.checked_div(10000))
            .and_then(|x| u16::try_from(x).ok())
            .unwrap_or(10000);
            
        Ok(final_multiplier)
    }
    
    fn calculate_loyalty_points(
        action_type: &ActionType,
        reward_amount: u64,
    ) -> u64 {
        let points_per_token = match action_type {
            ActionType::TicketPurchase => 10,
            ActionType::EventAttendance => 50,
            ActionType::Referral => 100,
            ActionType::Staking => 5,
            ActionType::GovernanceVote => 25,
            ActionType::SocialShare => 10,
            ActionType::ProfileCompletion => 100,
            ActionType::Custom => 10,
        };
        
        reward_amount * points_per_token
    }
    
    fn calculate_loyalty_tier(loyalty_points: u64) -> LoyaltyTier {
        match loyalty_points {
            0..=9_999 => LoyaltyTier::Bronze,
            10_000..=49_999 => LoyaltyTier::Silver,
            50_000..=149_999 => LoyaltyTier::Gold,
            150_000..=499_999 => LoyaltyTier::Platinum,
            500_000.. => LoyaltyTier::Diamond,
        }
    }
    
    fn is_authorized_distributor(key: &Pubkey) -> Result<bool> {
        // Check if the key is authorized to distribute rewards
        // This would typically check against a list of authorized programs
        Ok(true) // Simplified for now
    }
}
```

## Account Structures

**Location**: `tickettoken/contracts/programs/rewards/src/state.rs`

```rust
use anchor_lang::prelude::*;

#[account]
pub struct RewardsPool {
    pub authority: Pubkey,              // Program authority
    pub reward_token_mint: Pubkey,      // Token used for rewards
    pub config: RewardsConfig,          // Pool configuration
    pub total_distributed: u64,        // Total rewards distributed
    pub total_claimed: u64,             // Total rewards claimed by users
    pub active_campaigns: u32,          // Number of active campaigns
    pub created_at: i64,                // Creation timestamp
    pub bump: u8,                       // PDA bump seed
}

#[account]
pub struct Campaign {
    pub rewards_pool: Pubkey,           // Associated rewards pool
    pub campaign_type: CampaignType,    // Type of campaign
    pub name: String,                   // Campaign name (max 100 chars)
    pub description: String,            // Campaign description (max 500 chars)
    pub reward_amount: u64,             // Reward per participant
    pub total_budget: u64,              // Total campaign budget
    pub remaining_budget: u64,          // Remaining budget
    pub max_participants: u64,          // Maximum participants
    pub current_participants: u64,      // Current participant count
    pub start_time: i64,                // Campaign start time
    pub end_time: i64,                  // Campaign end time
    pub eligibility_criteria: EligibilityCriteria, // Who can participate
    pub status: CampaignStatus,         // Current status
    pub created_at: i64,                // Creation timestamp
    pub ended_at: Option<i64>,          // End timestamp (if ended early)
    pub end_reason: Option<String>,     // Reason for early end
    pub bump: u8,                       // PDA bump seed
}

#[account]
pub struct UserRewards {
    pub user: Pubkey,                   // User public key
    pub total_earned: u64,              // Total rewards earned
    pub total_claimed: u64,             // Total rewards claimed
    pub loyalty_tier: LoyaltyTier,      // Current loyalty tier
    pub loyalty_points: u64,            // Total loyalty points
    pub reward_entries: Vec<RewardEntry>, // Individual reward entries
    pub created_at: i64,                // First reward timestamp
    pub bump: u8,                       // PDA bump seed
}

// Configuration structures
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RewardsConfig {
    pub max_campaigns: u32,             // Maximum active campaigns
    pub min_campaign_duration: i64,     // Minimum campaign duration (seconds)
    pub max_campaign_duration: i64,     // Maximum campaign duration (seconds)
    pub max_reward_per_action: u64,     // Maximum reward per action
    pub loyalty_points_decay: bool,     // Whether loyalty points decay
    pub decay_period: i64,              // Decay period (seconds)
    pub decay_rate: u16,                // Decay rate (basis points)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct EligibilityCriteria {
    pub min_ticket_purchases: u32,      // Minimum ticket purchases
    pub min_event_attendance: u32,      // Minimum events attended
    pub min_staking_amount: u64,        // Minimum tokens staked
    pub min_loyalty_tier: LoyaltyTier,  // Minimum loyalty tier
    pub required_nfts: Vec<Pubkey>,     // Required NFT holdings
    pub single_participation: bool,     // Allow only single participation
    pub whitelist: Vec<Pubkey>,         // Whitelisted users (if empty, open to all)
    pub custom_conditions: Vec<u8>,     // Custom eligibility data
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardEntry {
    pub campaign: Pubkey,               // Associated campaign
    pub action_type: ActionType,        // Action that earned the reward
    pub amount: u64,                    // Reward amount
    pub timestamp: i64,                 // When earned
    pub claimed: bool,                  // Whether claimed
    pub metadata: Vec<u8>,              // Action-specific metadata
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StakerReward {
    pub staker: Pubkey,                 // Staker public key
    pub amount: u64,                    // Reward amount
    pub stake_amount: u64,              // Amount staked
    pub duration: i64,                  // Staking duration
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CampaignType {
    TicketPurchase,     // Rewards for buying tickets
    EventAttendance,    // Rewards for attending events
    Referral,          // Referral bonuses
    StakingRewards,    // Staking yield distribution
    Governance,        // Governance participation
    Social,           // Social media engagement
    Loyalty,          // Loyalty program rewards
    Airdrop,          // Token airdrops
    Custom,           // Custom campaign type
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum CampaignStatus {
    Active,     // Currently running
    Paused,     // Temporarily paused
    Ended,      // Completed or ended early
    Draft,      // Created but not started
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum LoyaltyTier {
    Bronze,     // 0-9,999 points
    Silver,     // 10,000-49,999 points
    Gold,       // 50,000-149,999 points
    Platinum,   // 150,000-499,999 points
    Diamond,    // 500,000+ points
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ActionType {
    TicketPurchase,     // Buying tickets
    EventAttendance,    // Attending events
    Referral,          // Referring new users
    Staking,           // Staking tokens
    GovernanceVote,    // Voting on proposals
    SocialShare,       // Sharing on social media
    ProfileCompletion, // Completing profile
    Custom,            // Custom action
}

impl Default for RewardsConfig {
    fn default() -> Self {
        Self {
            max_campaigns: 50,
            min_campaign_duration: 24 * 60 * 60,      // 1 day
            max_campaign_duration: 365 * 24 * 60 * 60, // 1 year
            max_reward_per_action: 1_000_000,         // 1M tokens
            loyalty_points_decay: false,
            decay_period: 365 * 24 * 60 * 60,         // 1 year
            decay_rate: 1000,                         // 10%
        }
    }
}

impl Default for EligibilityCriteria {
    fn default() -> Self {
        Self {
            min_ticket_purchases: 0,
            min_event_attendance: 0,
            min_staking_amount: 0,
            min_loyalty_tier: LoyaltyTier::Bronze,
            required_nfts: Vec::new(),
            single_participation: false,
            whitelist: Vec::new(),
            custom_conditions: Vec::new(),
        }
    }
}
```

## Context Structures

**Location**: `tickettoken/contracts/programs/rewards/src/contexts.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeRewards<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 400, // Account discriminator + RewardsPool size
        seeds = [b"rewards_pool"],
        bump
    )]
    pub rewards_pool: Account<'info, RewardsPool>,
    
    pub reward_token_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        token::mint = reward_token_mint,
        token::authority = rewards_pool,
    )]
    pub rewards_vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + 1000, // Account discriminator + Campaign size (estimated)
        seeds = [b"campaign", name.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    
    #[account(
        constraint = authority.key() == rewards_pool.authority
    )]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EarnRewards<'info> {
    pub rewards_pool: Account<'info, RewardsPool>,
    
    pub campaign: Account<'info, Campaign>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 1500, // Account discriminator + UserRewards size (estimated)
        seeds = [b"user_rewards", user.key().as_ref()],
        bump
    )]
    pub user_rewards: Account<'info, UserRewards>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(
        mut,
        seeds = [b"user_rewards", user_rewards.user.as_ref()],
        bump = user_rewards.bump
    )]
    pub user_rewards: Account<'info, UserRewards>,
    
    #[account(
        constraint = authority.key() == rewards_pool.authority
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EndCampaign<'info> {
    #[account(mut)]
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    
    #[account(
        constraint = authority.key() == rewards_pool.authority
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(
        mut,
        constraint = rewards_vault.mint == rewards_pool.reward_token_mint,
        constraint = rewards_vault.owner == rewards_pool.key()
    )]
    pub rewards_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = depositor_token_account.mint == rewards_pool.reward_token_mint,
        constraint = depositor_token_account.owner == depositor.key()
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}
```

## Events

**Location**: `tickettoken/contracts/programs/rewards/src/events.rs`

```rust
use anchor_lang::prelude::*;
use crate::state::{RewardsConfig, CampaignType, ActionType, LoyaltyTier};

#[event]
pub struct RewardsInitialized {
    pub rewards_pool: Pubkey,
    pub authority: Pubkey,
    pub reward_token: Pubkey,
    pub config: RewardsConfig,
}

#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub campaign_type: CampaignType,
    pub name: String,
    pub reward_amount: u64,
    pub total_budget: u64,
    pub max_participants: u64,
}

#[event]
pub struct RewardsEarned {
    pub user: Pubkey,
    pub campaign: Pubkey,
    pub action_type: ActionType,
    pub reward_amount: u64,
    pub loyalty_points: u64,
    pub loyalty_tier: LoyaltyTier,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub campaigns_count: u32,
    pub new_total_claimed: u64,
}

#[event]
pub struct StakingRewardsDistributed {
    pub total_amount: u64,
    pub stakers_count: u32,
    pub distribution_round: u64,
}

#[event]
pub struct LoyaltyTierUpdated {
    pub user: Pubkey,
    pub old_tier: LoyaltyTier,
    pub new_tier: LoyaltyTier,
    pub updated_by: Pubkey,
}

#[event]
pub struct CampaignEnded {
    pub campaign: Pubkey,
    pub reason: String,
    pub remaining_budget: u64,
    pub participants: u64,
}

#[event]
pub struct RewardsDeposited {
    pub depositor: Pubkey,
    pub amount: u64,
    pub new_vault_balance: u64,
}
```

## Errors

**Location**: `tickettoken/contracts/programs/rewards/src/error.rs`

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum RewardsError {
    #[msg("Invalid campaign duration")]
    InvalidCampaignDuration,
    
    #[msg("Invalid reward amount")]
    InvalidRewardAmount,
    
    #[msg("Insufficient campaign budget")]
    InsufficientCampaignBudget,
    
    #[msg("Campaign is not active")]
    CampaignNotActive,
    
    #[msg("User is not eligible for this campaign")]
    UserNotEligible,
    
    #[msg("Campaign budget has been exhausted")]
    CampaignBudgetExhausted,
    
    #[msg("User has already participated in this campaign")]
    UserAlreadyParticipated,
    
    #[msg("Reward calculation overflow")]
    RewardCalculationOverflow,
    
    #[msg("Claim amount calculation overflow")]
    ClaimAmountOverflow,
    
    #[msg("No rewards available to claim")]
    NoRewardsToClaim,
    
    #[msg("Insufficient balance in rewards vault")]
    InsufficientRewardsVault,
    
    #[msg("Unauthorized distribution attempt")]
    UnauthorizedDistribution,
    
    #[msg("Distribution amount mismatch")]
    DistributionAmountMismatch,
    
    #[msg("Unauthorized loyalty tier update")]
    UnauthorizedTierUpdate,
    
    #[msg("Unauthorized campaign termination")]
    UnauthorizedCampaignEnd,
    
    #[msg("Invalid loyalty tier")]
    InvalidLoyaltyTier,
    
    #[msg("Campaign already ended")]
    CampaignAlreadyEnded,
    
    #[msg("Maximum campaigns limit reached")]
    MaxCampaignsReached,
    
    #[msg("Invalid eligibility criteria")]
    InvalidEligibilityCriteria,
    
    #[msg("Reward entry not found")]
    RewardEntryNotFound,
    
    #[msg("Invalid action type")]
    InvalidActionType,
    
    #[msg("Points decay calculation error")]
    PointsDecayError,
    
    #[msg("Campaign budget insufficient for rewards")]
    InsufficientBudgetForRewards,
    
    #[msg("Invalid campaign configuration")]
    InvalidCampaignConfig,
    
    #[msg("User rewards account not initialized")]
    UserRewardsNotInitialized,
}
```

## Usage Examples

### Initialize Rewards System

```typescript
const rewardsConfig = {
  maxCampaigns: 50,
  minCampaignDuration: new BN(24 * 60 * 60), // 1 day
  maxCampaignDuration: new BN(365 * 24 * 60 * 60), // 1 year
  maxRewardPerAction: new BN(1_000_000), // 1M tokens
  loyaltyPointsDecay: false,
  decayPeriod: new BN(365 * 24 * 60 * 60), // 1 year
  decayRate: 1000, // 10%
};

await rewardsProgram.methods
  .initializeRewards(rewardsConfig)
  .accounts({
    rewardsPool: rewardsPoolPDA,
    rewardTokenMint: rewardTokenMint.publicKey,
    rewardsVault: rewardsVaultAccount,
    authority: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([authority])
  .rpc();
```

### Create a Campaign

```typescript
const campaignType = { ticketPurchase: {} };
const name = "Summer Festival Rewards";
const description = "Earn tokens for purchasing festival tickets";
const rewardAmount = new BN(1000); // 1000 tokens per ticket
const totalBudget = new BN(100000); // 100K tokens total
const startTime = new BN(Date.now() / 1000);
const endTime = new BN(Date.now() / 1000 + 30 * 24 * 60 * 60); // 30 days

const eligibilityCriteria = {
  minTicketPurchases: 0,
  minEventAttendance: 0,
  minStakingAmount: new BN(0),
  minLoyaltyTier: { bronze: {} },
  requiredNfts: [],
  singleParticipation: false,
  whitelist: [],
  customConditions: [],
};

await rewardsProgram.methods
  .createCampaign(
    campaignType,
    name,
    description,
    rewardAmount,
    totalBudget,
    startTime,
    endTime,
    eligibilityCriteria
  )
  .accounts({
    rewardsPool: rewardsPoolPDA,
    campaign: campaignPDA,
    authority: authority.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

### Earn Rewards

```typescript
const actionType = { ticketPurchase: {} };
const metadata = Buffer.from(JSON.stringify({
  eventId: "event-123",
  ticketType: "VIP",
  purchaseAmount: 250,
}));

await rewardsProgram.methods
  .earnRewards(actionType, Array.from(metadata))
  .accounts({
    rewardsPool: rewardsPoolPDA,
    campaign: campaignPDA,
    userRewards: userRewardsPDA,
    user: user.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user])
  .rpc();
```

### Claim Rewards

```typescript
const campaignIds = []; // Empty array means claim from all campaigns

await rewardsProgram.methods
  .claimRewards(campaignIds)
  .accounts({
    rewardsPool: rewardsPoolPDA,
    userRewards: userRewardsPDA,
    rewardsVault: rewardsVaultAccount,
    userTokenAccount: userTokenAccount,
    user: user.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([user])
  .rpc();
```

### Distribute Staking Rewards

```typescript
const stakersRewards = [
  {
    staker: staker1.publicKey,
    amount: new BN(5000),
    stakeAmount: new BN(100000),
    duration: new BN(30 * 24 * 60 * 60), // 30 days
  },
  {
    staker: staker2.publicKey,
    amount: new BN(3000),
    stakeAmount: new BN(60000),
    duration: new BN(30 * 24 * 60 * 60),
  },
];

const totalAmount = stakersRewards.reduce((sum, s) => sum.add(s.amount), new BN(0));

await rewardsProgram.methods
  .distributeStakingRewards(totalAmount, stakersRewards)
  .accounts({
    rewardsPool: rewardsPoolPDA,
    rewardsVault: rewardsVaultAccount,
    authority: authority.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .remainingAccounts([
    { pubkey: staker1TokenAccount, isSigner: false, isWritable: true },
    { pubkey: staker2TokenAccount, isSigner: false, isWritable: true },
  ])
  .signers([authority])
  .rpc();
```

## Integration Points

### With Ticket Minter Program
- **Purchase Rewards**: Automatic rewards for ticket purchases
- **Attendance Verification**: Rewards for event attendance
- **NFT Integration**: Rewards based on NFT ownership

### With Staking Program
- **Yield Distribution**: Distribute staking rewards to users
- **Multipliers**: Higher rewards for stakers
- **Compound Rewards**: Stake rewards for additional benefits

### With Governance Program
- **Voting Rewards**: Incentivize governance participation
- **Proposal Rewards**: Rewards for successful proposals
- **Delegation Bonuses**: Additional rewards for delegation

### With Marketplace Program
- **Trading Rewards**: Rewards for marketplace activity
- **Liquidity Incentives**: Market-making rewards
- **Volume Bonuses**: Rewards based on trading volume

## Reward Mechanics

### Loyalty Tiers
- **Bronze** (0-9,999 points): 1.0x multiplier
- **Silver** (10,000-49,999 points): 1.1x multiplier
- **Gold** (50,000-149,999 points): 1.25x multiplier
- **Platinum** (150,000-499,999 points): 1.5x multiplier
- **Diamond** (500,000+ points): 2.0x multiplier

### Action Multipliers
- **Ticket Purchase**: 1.0x base
- **Event Attendance**: 1.5x base
- **Referral**: 2.0x base
- **Staking**: 1.2x base
- **Governance Vote**: 1.1x base
- **Social Share**: 0.5x base
- **Profile Completion**: 0.8x base

### Loyalty Points Calculation
Points are earned based on action type and reward amount:
- **Ticket Purchase**: 10 points per token
- **Event Attendance**: 50 points per token
- **Referral**: 100 points per token
- **Staking**: 5 points per token
- **Governance Vote**: 25 points per token
- **Social Share**: 10 points per token
- **Profile Completion**: 100 points per token

## Security Features

1. **Access Control**: Only authorized accounts can create campaigns
2. **Eligibility Verification**: Strict checks for campaign participation
3. **Budget Management**: Prevents over-spending campaign budgets
4. **Claim Protection**: Users can only claim their own rewards
5. **Overflow Protection**: Safe arithmetic for all calculations
6. **Audit Trail**: Comprehensive event logging for all actions

## Testing

Tests are located in `tickettoken/contracts/tests/rewards.ts`

```bash
cd tickettoken/contracts
anchor test -- --features rewards
```

### Test Coverage
- ✅ Rewards system initialization
- ✅ Campaign creation and management
- ✅ Reward earning and calculation
- ✅ Claim mechanisms
- ✅ Loyalty tier progression
- ✅ Staking reward distribution
- ✅ Access control and security
- ✅ Error handling and edge cases

## Analytics and Monitoring

### Key Metrics
- Total rewards distributed
- Active campaigns count
- User participation rates
- Loyalty tier distribution
- Claim frequency and amounts

### Campaign Performance
- Participation rates by campaign type
- Average reward per user
- Budget utilization rates
- Time-to-completion analysis

## Deployment

### Environment Setup
```toml
# Anchor.toml
[programs.localnet]
rewards = "Rewards..."

[programs.devnet]
rewards = "Rewards..."

[programs.mainnet]
rewards = "Rewards..."
```

### Deployment Steps
1. Deploy reward token contract
2. Initialize rewards pool with configuration
3. Fund initial rewards vault
4. Create initial campaigns
5. Integrate with other platform programs

## Future Enhancements

### Planned Features
1. **Dynamic Campaigns**: AI-powered campaign optimization
2. **Cross-Chain Rewards**: Multi-blockchain reward distribution
3. **NFT Rewards**: Unique NFT rewards for achievements
4. **Seasonal Events**: Time-limited special campaigns
5. **Social Integration**: Social media reward verification
6. **Gamification**: Achievement systems and badges

### Technical Improvements
1. **Gas Optimization**: Reduce transaction costs
2. **Batch Processing**: Efficient bulk operations
3. **Advanced Analytics**: Real-time reward analytics
4. **Mobile Integration**: Mobile-specific reward features

## Conclusion

The Rewards program provides a comprehensive incentive system for the TicketToken platform, encouraging user engagement through token rewards, loyalty programs, and staking benefits. With flexible campaign creation, automatic tier progression, and seamless integration with other platform components, it creates a robust ecosystem for user retention and platform growth.

The system is designed to be scalable, secure, and adaptable to changing platform needs while maintaining transparency and fairness in reward distribution.

---

**Related Documentation:**
- [Staking Program](../staking/README.md)
- [Governance Program](../governance/README.md)
- [Main Contracts Documentation](../../README.md) [b"user_rewards", user.key().as_ref()],
        bump = user_rewards.bump
    )]
    pub user_rewards: Account<'info, UserRewards>,
    
    #[account(
        mut,
        constraint = rewards_vault.mint == rewards_pool.reward_token_mint,
        constraint = rewards_vault.owner == rewards_pool.key()
    )]
    pub rewards_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == rewards_pool.reward_token_mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DistributeStakingRewards<'info> {
    #[account(mut)]
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(
        mut,
        constraint = rewards_vault.mint == rewards_pool.reward_token_mint,
        constraint = rewards_vault.owner == rewards_pool.key()
    )]
    pub rewards_vault: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    
    // Additional staker token accounts passed as remaining_accounts
}

#[derive(Accounts)]
pub struct UpdateLoyaltyTier<'info> {
    pub rewards_pool: Account<'info, RewardsPool>,
    
    #[account(
    mut,
    seeds = [b"user_rewards", user_rewards.user.as_ref()],
    bump = user_rewards.bump
)]
pub user_rewards: Account<'info, UserRewards>,
