# Governance Program Documentation

**Location**: `tickettoken/contracts/programs/governance/src/lib.rs`
**Program ID**: `Govern...` (Replace with actual deployed address)
**Purpose**: Manages DAO governance, proposals, voting mechanisms, and treasury operations

## Overview

The Governance program enables decentralized decision-making for the TicketToken platform through:
- DAO creation and configuration
- Proposal submission and voting
- Token-weighted voting power
- Automatic execution of passed proposals
- Treasury management integration
- Multi-signature operations for critical functions

## Program Structure

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("Govern...");

#[program]
pub mod governance {
    use super::*;

    /// Initialize the DAO governance system
    pub fn initialize_dao(
        ctx: Context<InitializeDao>,
        config: DaoConfig,
    ) -> Result<()> {
        let dao = &mut ctx.accounts.dao;
        
        dao.authority = ctx.accounts.authority.key();
        dao.governance_token_mint = ctx.accounts.governance_token_mint.key();
        dao.config = config;
        dao.proposal_count = 0;
        dao.total_voting_power = 0;
        dao.treasury = ctx.accounts.treasury.key();
        dao.created_at = Clock::get()?.unix_timestamp;
        dao.bump = *ctx.bumps.get("dao").unwrap();
        
        emit!(DaoInitialized {
            dao: dao.key(),
            authority: dao.authority,
            governance_token: dao.governance_token_mint,
            config: dao.config,
        });
        
        Ok(())
    }

    /// Create a new governance proposal
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        description: String,
        proposal_type: ProposalType,
        execution_instructions: Vec<ProposalInstruction>,
        voting_period: i64,
    ) -> Result<()> {
        let dao = &mut ctx.accounts.dao;
        let proposal = &mut ctx.accounts.proposal;
        
        // Validate proposer has minimum tokens
        require!(
            ctx.accounts.proposer_token_account.amount >= dao.config.min_tokens_to_propose,
            GovernanceError::InsufficientTokensToPropose
        );
        
        // Validate voting period is within bounds
        require!(
            voting_period >= dao.config.min_voting_period && 
            voting_period <= dao.config.max_voting_period,
            GovernanceError::InvalidVotingPeriod
        );
        
        let current_time = Clock::get()?.unix_timestamp;
        dao.proposal_count += 1;
        
        proposal.dao = dao.key();
        proposal.proposal_id = dao.proposal_count;
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.title = title;
        proposal.description = description;
        proposal.proposal_type = proposal_type;
        proposal.execution_instructions = execution_instructions;
        proposal.status = ProposalStatus::Active;
        proposal.votes_for = 0;
        proposal.votes_against = 0;
        proposal.votes_abstain = 0;
        proposal.total_voting_power = dao.total_voting_power;
        proposal.created_at = current_time;
        proposal.voting_starts_at = current_time + dao.config.discussion_period;
        proposal.voting_ends_at = proposal.voting_starts_at + voting_period;
        proposal.executed_at = None;
        proposal.cancelled_at = None;
        proposal.bump = *ctx.bumps.get("proposal").unwrap();
        
        emit!(ProposalCreated {
            dao: dao.key(),
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
            proposer: proposal.proposer,
            title: proposal.title.clone(),
            proposal_type: proposal.proposal_type,
            voting_starts_at: proposal.voting_starts_at,
            voting_ends_at: proposal.voting_ends_at,
        });
        
        Ok(())
    }

    /// Cast a vote on a proposal
    pub fn cast_vote(
        ctx: Context<CastVote>,
        vote_type: VoteType,
        weight: Option<u64>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let vote = &mut ctx.accounts.vote;
        let dao = &ctx.accounts.dao;
        
        // Check voting period is active
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= proposal.voting_starts_at && current_time <= proposal.voting_ends_at,
            GovernanceError::VotingPeriodNotActive
        );
        
        // Check proposal is active
        require!(
            proposal.status == ProposalStatus::Active,
            GovernanceError::ProposalNotActive
        );
        
        // Calculate voting power
        let voting_power = if let Some(w) = weight {
            // Custom weight (for delegated voting)
            require!(w <= ctx.accounts.voter_token_account.amount, GovernanceError::InsufficientVotingPower);
            w
        } else {
            // Use full token balance
            ctx.accounts.voter_token_account.amount
        };
        
        require!(voting_power > 0, GovernanceError::InsufficientVotingPower);
        
        // Create vote record
        vote.proposal = proposal.key();
        vote.voter = ctx.accounts.voter.key();
        vote.vote_type = vote_type;
        vote.voting_power = voting_power;
        vote.created_at = current_time;
        vote.bump = *ctx.bumps.get("vote").unwrap();
        
        // Update proposal vote counts
        match vote_type {
            VoteType::For => proposal.votes_for += voting_power,
            VoteType::Against => proposal.votes_against += voting_power,
            VoteType::Abstain => proposal.votes_abstain += voting_power,
        }
        
        // Lock tokens during voting period (prevent transfers)
        if dao.config.lock_tokens_during_vote {
            // Implementation depends on token locking mechanism
            // Could involve transferring to a locked account
        }
        
        emit!(VoteCast {
            proposal: proposal.key(),
            voter: vote.voter,
            vote_type: vote.vote_type,
            voting_power: vote.voting_power,
        });
        
        Ok(())
    }

    /// Cancel a proposal (proposer or authority only)
    pub fn cancel_proposal(
        ctx: Context<CancelProposal>,
        reason: String,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let dao = &ctx.accounts.dao;
        
        // Only proposer or DAO authority can cancel
        require!(
            ctx.accounts.canceller.key() == proposal.proposer ||
            ctx.accounts.canceller.key() == dao.authority,
            GovernanceError::UnauthorizedCancel
        );
        
        // Can only cancel active proposals
        require!(
            proposal.status == ProposalStatus::Active,
            GovernanceError::ProposalNotActive
        );
        
        proposal.status = ProposalStatus::Cancelled;
        proposal.cancelled_at = Some(Clock::get()?.unix_timestamp);
        proposal.cancel_reason = Some(reason.clone());
        
        emit!(ProposalCancelled {
            proposal: proposal.key(),
            cancelled_by: ctx.accounts.canceller.key(),
            reason,
        });
        
        Ok(())
    }

    /// Finalize voting and determine proposal outcome
    pub fn finalize_proposal(
        ctx: Context<FinalizeProposal>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let dao = &ctx.accounts.dao;
        
        // Check voting period has ended
        require!(
            Clock::get()?.unix_timestamp > proposal.voting_ends_at,
            GovernanceError::VotingPeriodNotEnded
        );
        
        // Can only finalize active proposals
        require!(
            proposal.status == ProposalStatus::Active,
            GovernanceError::ProposalNotActive
        );
        
        // Calculate results
        let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;
        let participation_rate = if proposal.total_voting_power > 0 {
            (total_votes * 10000) / proposal.total_voting_power // Basis points
        } else {
            0
        };
        
        // Check if quorum is met
        if participation_rate < dao.config.quorum_threshold_bps {
            proposal.status = ProposalStatus::Failed;
            proposal.failure_reason = Some("Quorum not met".to_string());
        } else {
            // Check approval threshold
            let approval_rate = if (proposal.votes_for + proposal.votes_against) > 0 {
                (proposal.votes_for * 10000) / (proposal.votes_for + proposal.votes_against)
            } else {
                0
            };
            
            if approval_rate >= dao.config.approval_threshold_bps {
                proposal.status = ProposalStatus::Passed;
                
                // Queue for execution if auto-execution is enabled
                if dao.config.auto_execute_passed_proposals {
                    proposal.execution_scheduled_at = Some(
                        Clock::get()?.unix_timestamp + dao.config.execution_delay
                    );
                }
            } else {
                proposal.status = ProposalStatus::Failed;
                proposal.failure_reason = Some("Insufficient approval votes".to_string());
            }
        }
        
        proposal.finalized_at = Some(Clock::get()?.unix_timestamp);
        
        emit!(ProposalFinalized {
            proposal: proposal.key(),
            status: proposal.status,
            votes_for: proposal.votes_for,
            votes_against: proposal.votes_against,
            votes_abstain: proposal.votes_abstain,
            participation_rate,
            approval_rate: if proposal.status == ProposalStatus::Passed { Some(approval_rate) } else { None },
        });
        
        Ok(())
    }

    /// Execute a passed proposal
    pub fn execute_proposal(
        ctx: Context<ExecuteProposal>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let dao = &ctx.accounts.dao;
        
        // Check proposal has passed
        require!(
            proposal.status == ProposalStatus::Passed,
            GovernanceError::ProposalNotPassed
        );
        
        // Check execution delay has passed
        if let Some(scheduled_at) = proposal.execution_scheduled_at {
            require!(
                Clock::get()?.unix_timestamp >= scheduled_at,
                GovernanceError::ExecutionDelayNotMet
            );
        }
        
        // Verify executor authority (for sensitive operations)
        match proposal.proposal_type {
            ProposalType::ConfigChange | ProposalType::TreasurySpend | ProposalType::EmergencyAction => {
                require!(
                    ctx.accounts.executor.key() == dao.authority,
                    GovernanceError::UnauthorizedExecution
                );
            },
            _ => {
                // Any authorized member can execute other proposal types
            }
        }
        
        // Execute instructions
        for instruction in &proposal.execution_instructions {
            Self::execute_instruction(ctx.remaining_accounts, instruction)?;
        }
        
        proposal.status = ProposalStatus::Executed;
        proposal.executed_at = Some(Clock::get()?.unix_timestamp);
        proposal.executed_by = Some(ctx.accounts.executor.key());
        
        emit!(ProposalExecuted {
            proposal: proposal.key(),
            executed_by: ctx.accounts.executor.key(),
            executed_at: proposal.executed_at.unwrap(),
        });
        
        Ok(())
    }

    /// Delegate voting power to another account
    pub fn delegate_voting_power(
        ctx: Context<DelegateVotingPower>,
        amount: u64,
    ) -> Result<()> {
        let delegation = &mut ctx.accounts.delegation;
        let dao = &ctx.accounts.dao;
        
        // Verify delegator has enough tokens
        require!(
            ctx.accounts.delegator_token_account.amount >= amount,
            GovernanceError::InsufficientTokensToDelegate
        );
        
        // Check delegation is enabled
        require!(
            dao.config.allow_vote_delegation,
            GovernanceError::DelegationNotAllowed
        );
        
        delegation.dao = dao.key();
        delegation.delegator = ctx.accounts.delegator.key();
        delegation.delegate = ctx.accounts.delegate.key();
        delegation.amount = amount;
        delegation.created_at = Clock::get()?.unix_timestamp;
        delegation.bump = *ctx.bumps.get("delegation").unwrap();
        
        // Transfer tokens to delegation escrow
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.delegator_token_account.to_account_info(),
            to: ctx.accounts.delegation_escrow.to_account_info(),
            authority: ctx.accounts.delegator.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        emit!(VotingPowerDelegated {
            dao: dao.key(),
            delegator: delegation.delegator,
            delegate: delegation.delegate,
            amount: delegation.amount,
        });
        
        Ok(())
    }

    /// Revoke delegated voting power
    pub fn revoke_delegation(
        ctx: Context<RevokeDelegation>,
    ) -> Result<()> {
        let delegation = &mut ctx.accounts.delegation;
        
        // Only delegator can revoke
        require!(
            ctx.accounts.delegator.key() == delegation.delegator,
            GovernanceError::UnauthorizedDelegationRevoke
        );
        
        // Return tokens to delegator
        let seeds = &[
            b"delegation",
            delegation.dao.as_ref(),
            delegation.delegator.as_ref(),
            delegation.delegate.as_ref(),
            &[delegation.bump],
        ];
        let signer = &[&seeds[..]];
        
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.delegation_escrow.to_account_info(),
            to: ctx.accounts.delegator_token_account.to_account_info(),
            authority: delegation.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, delegation.amount)?;
        
        emit!(DelegationRevoked {
            dao: delegation.dao,
            delegator: delegation.delegator,
            delegate: delegation.delegate,
            amount: delegation.amount,
        });
        
        Ok(())
    }

    /// Update DAO configuration (via governance only)
    pub fn update_dao_config(
        ctx: Context<UpdateDaoConfig>,
        new_config: DaoConfig,
    ) -> Result<()> {
        let dao = &mut ctx.accounts.dao;
        
        // This should only be called via proposal execution
        // Additional validation can be added here
        
        let old_config = dao.config;
        dao.config = new_config;
        
        emit!(DaoConfigUpdated {
            dao: dao.key(),
            old_config,
            new_config,
        });
        
        Ok(())
    }
}

// Helper implementation for instruction execution
impl governance {
    fn execute_instruction(
        remaining_accounts: &[AccountInfo],
        instruction: &ProposalInstruction,
    ) -> Result<()> {
        match instruction.instruction_type {
            InstructionType::Transfer => {
                // Execute SOL or SPL token transfer
                Self::execute_transfer(remaining_accounts, instruction)?;
            },
            InstructionType::ProgramUpgrade => {
                // Execute program upgrade
                Self::execute_program_upgrade(remaining_accounts, instruction)?;
            },
            InstructionType::ConfigUpdate => {
                // Execute configuration update
                Self::execute_config_update(remaining_accounts, instruction)?;
            },
            InstructionType::Custom => {
                // Execute custom cross-program invocation
                Self::execute_custom_instruction(remaining_accounts, instruction)?;
            },
        }
        Ok(())
    }
    
    fn execute_transfer(
        remaining_accounts: &[AccountInfo],
        instruction: &ProposalInstruction,
    ) -> Result<()> {
        // Implementation for treasury transfers
        // Would parse instruction data and execute transfers
        Ok(())
    }
    
    fn execute_program_upgrade(
        remaining_accounts: &[AccountInfo],
        instruction: &ProposalInstruction,
    ) -> Result<()> {
        // Implementation for program upgrades
        // Would interact with Solana's BPF loader
        Ok(())
    }
    
    fn execute_config_update(
        remaining_accounts: &[AccountInfo],
        instruction: &ProposalInstruction,
    ) -> Result<()> {
        // Implementation for updating other program configs
        // Would call update functions on other programs
        Ok(())
    }
    
    fn execute_custom_instruction(
        remaining_accounts: &[AccountInfo],
        instruction: &ProposalInstruction,
    ) -> Result<()> {
        // Implementation for custom instructions
        // Would deserialize and execute arbitrary instructions
        Ok(())
    }
}
```

## Account Structures

**Location**: `tickettoken/contracts/programs/governance/src/state.rs`

```rust
use anchor_lang::prelude::*;

#[account]
pub struct Dao {
    pub authority: Pubkey,              // Initial authority (can be changed via governance)
    pub governance_token_mint: Pubkey,  // Token used for voting
    pub treasury: Pubkey,               // Treasury account
    pub config: DaoConfig,              // DAO configuration
    pub proposal_count: u64,            // Total proposals created
    pub total_voting_power: u64,        // Total tokens eligible for voting
    pub created_at: i64,                // Creation timestamp
    pub bump: u8,                       // PDA bump seed
}

#[account]
pub struct Proposal {
    pub dao: Pubkey,                    // Associated DAO
    pub proposal_id: u64,               // Sequential proposal ID
    pub proposer: Pubkey,               // Who created the proposal
    pub title: String,                  // Proposal title (max 100 chars)
    pub description: String,            // Detailed description (max 2000 chars)
    pub proposal_type: ProposalType,    // Type of proposal
    pub execution_instructions: Vec<ProposalInstruction>, // Instructions to execute
    pub status: ProposalStatus,         // Current status
    pub votes_for: u64,                 // Total votes in favor
    pub votes_against: u64,             // Total votes against
    pub votes_abstain: u64,             // Total abstain votes
    pub total_voting_power: u64,        // Total voting power when created
    pub created_at: i64,                // Creation timestamp
    pub voting_starts_at: i64,          // When voting begins
    pub voting_ends_at: i64,            // When voting ends
    pub finalized_at: Option<i64>,      // When finalized
    pub executed_at: Option<i64>,       // When executed
    pub cancelled_at: Option<i64>,      // When cancelled
    pub execution_scheduled_at: Option<i64>, // Scheduled execution time
    pub executed_by: Option<Pubkey>,    // Who executed the proposal
    pub failure_reason: Option<String>, // Why it failed (if applicable)
    pub cancel_reason: Option<String>,  // Why it was cancelled (if applicable)
    pub bump: u8,                       // PDA bump seed
}

#[account]
pub struct Vote {
    pub proposal: Pubkey,               // Associated proposal
    pub voter: Pubkey,                  // Who cast the vote
    pub vote_type: VoteType,            // For/Against/Abstain
    pub voting_power: u64,              // Weight of the vote
    pub created_at: i64,                // When vote was cast
    pub bump: u8,                       // PDA bump seed
}

#[account]
pub struct VotingPowerDelegation {
    pub dao: Pubkey,                    // Associated DAO
    pub delegator: Pubkey,              // Who delegated
    pub delegate: Pubkey,               // Who received delegation
    pub amount: u64,                    // Amount delegated
    pub created_at: i64,                // Creation timestamp
    pub bump: u8,                       // PDA bump seed
}

// Configuration structure
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct DaoConfig {
    pub min_tokens_to_propose: u64,     // Minimum tokens needed to create proposal
    pub quorum_threshold_bps: u16,      // Minimum participation (basis points)
    pub approval_threshold_bps: u16,    // Minimum approval rate (basis points)
    pub min_voting_period: i64,         // Minimum voting duration (seconds)
    pub max_voting_period: i64,         // Maximum voting duration (seconds)
    pub discussion_period: i64,         // Time before voting starts (seconds)
    pub execution_delay: i64,           // Delay before execution (seconds)
    pub auto_execute_passed_proposals: bool, // Auto-execute on pass
    pub allow_vote_delegation: bool,    // Enable vote delegation
    pub lock_tokens_during_vote: bool,  // Lock tokens during voting
    pub max_execution_instructions: u8, // Max instructions per proposal
}

// Enums
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalType {
    ConfigChange,       // Update DAO configuration
    TreasurySpend,      // Spend from treasury
    ParameterUpdate,    // Update platform parameters
    EmergencyAction,    // Emergency pause/unpause
    ProgramUpgrade,     // Upgrade program code
    Partnership,        // Partnership/integration approval
    FeatureToggle,      // Enable/disable features
    Bounty,            // Create bounty programs
    Custom,            // Custom proposal type
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    Active,     // Currently in voting period
    Passed,     // Passed but not executed
    Failed,     // Failed to meet requirements
    Executed,   // Successfully executed
    Cancelled,  // Cancelled before completion
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum VoteType {
    For,        // Vote in favor
    Against,    // Vote against
    Abstain,    // Abstain from vote
}

// Instruction execution structures
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProposalInstruction {
    pub instruction_type: InstructionType,
    pub program_id: Pubkey,             // Target program
    pub accounts: Vec<AccountMeta>,     // Account metadata
    pub data: Vec<u8>,                  // Instruction data
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum InstructionType {
    Transfer,           // SOL or SPL token transfer
    ProgramUpgrade,     // Program code upgrade
    ConfigUpdate,       // Configuration update
    Custom,            // Custom instruction
}

impl Default for DaoConfig {
    fn default() -> Self {
        Self {
            min_tokens_to_propose: 1_000_000,      // 1M tokens
            quorum_threshold_bps: 1000,            // 10%
            approval_threshold_bps: 5000,          // 50%
            min_voting_period: 3 * 24 * 60 * 60,   // 3 days
            max_voting_period: 14 * 24 * 60 * 60,  // 14 days
            discussion_period: 24 * 60 * 60,       // 1 day
            execution_delay: 2 * 24 * 60 * 60,     // 2 days
            auto_execute_passed_proposals: false,
            allow_vote_delegation: true,
            lock_tokens_during_vote: true,
            max_execution_instructions: 10,
        }
    }
}
```

## Context Structures

**Location**: `tickettoken/contracts/programs/governance/src/contexts.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeDao<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 500, // Account discriminator + Dao size
        seeds = [b"dao"],
        bump
    )]
    pub dao: Account<'info, Dao>,
    
    pub governance_token_mint: Account<'info, Mint>,
    
    /// CHECK: Treasury account will be validated by the treasury program
    pub treasury: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub dao: Account<'info, Dao>,
    
    #[account(
        init,
        payer = proposer,
        space = 8 + 2000, // Account discriminator + Proposal size (estimated)
        seeds = [b"proposal", dao.key().as_ref(), &dao.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(
        constraint = proposer_token_account.mint == dao.governance_token_mint,
        constraint = proposer_token_account.owner == proposer.key()
    )]
    pub proposer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub proposer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub dao: Account<'info, Dao>,
    
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    
    #[account(
        init,
        payer = voter,
        space = 8 + 150, // Account discriminator + Vote size
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, Vote>,
    
    #[account(
        constraint = voter_token_account.mint == dao.governance_token_mint,
        constraint = voter_token_account.owner == voter.key()
    )]
    pub voter_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub voter: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub dao: Account<'info, Dao>,
    
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    
    pub canceller: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    pub dao: Account<'info, Dao>,
    
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    pub dao: Account<'info, Dao>,
    
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    
    pub executor: Signer<'info>,
    
    // Additional accounts for proposal execution will be passed as remaining_accounts
}

#[derive(Accounts)]
pub struct DelegateVotingPower<'info> {
    pub dao: Account<'info, Dao>,
    
    #[account(
        init,
        payer = delegator,
        space = 8 + 150, // Account discriminator + VotingPowerDelegation size
        seeds = [b"delegation", dao.key().as_ref(), delegator.key().as_ref(), delegate.key().as_ref()],
        bump
    )]
    pub delegation: Account<'info, VotingPowerDelegation>,
    
    #[account(
        mut,
        constraint = delegator_token_account.mint == dao.governance_token_mint,
        constraint = delegator_token_account.owner == delegator.key()
    )]
    pub delegator_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = delegator,
        token::mint = dao.governance_token_mint,
        token::authority = delegation,
    )]
    pub delegation_escrow: Account<'info, TokenAccount>,
    
    /// CHECK: Delegate account will be validated by token account ownership
    pub delegate: AccountInfo<'info>,
    
    #[account(mut)]
    pub delegator: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
    #[account(mut)]
    pub delegation: Account<'info, VotingPowerDelegation>,
    
    #[account(
        mut,
        constraint = delegation_escrow.mint == delegation.dao,
        constraint = delegation_escrow.owner == delegation.key()
    )]
    pub delegation_escrow: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = delegator_token_account.owner == delegator.key()
    )]
    pub delegator_token_account: Account<'info, TokenAccount>,
    
    #[account(
        constraint = delegator.key() == delegation.delegator
    )]
    pub delegator: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateDaoConfig<'info> {
    #[account(mut)]
    pub dao: Account<'info, Dao>,
}
```

## Events

**Location**: `tickettoken/contracts/programs/governance/src/events.rs`

```rust
use anchor_lang::prelude::*;
use crate::state::{DaoConfig, ProposalType, ProposalStatus, VoteType};

#[event]
pub struct DaoInitialized {
    pub dao: Pubkey,
    pub authority: Pubkey,
    pub governance_token: Pubkey,
    pub config: DaoConfig,
}

#[event]
pub struct ProposalCreated {
    pub dao: Pubkey,
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub title: String,
    pub proposal_type: ProposalType,
    pub voting_starts_at: i64,
    pub voting_ends_at: i64,
}

#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub vote_type: VoteType,
    pub voting_power: u64,
}

#[event]
pub struct ProposalCancelled {
    pub proposal: Pubkey,
    pub cancelled_by: Pubkey,
    pub reason: String,
}

#[event]
pub struct ProposalFinalized {
    pub proposal: Pubkey,
    pub status: ProposalStatus,
    pub votes_for: u64,
    pub votes_against: u64,
    pub votes_abstain: u64,
    pub participation_rate: u64,     // In basis points
    pub approval_rate: Option<u64>,  // In basis points, if passed
}

#[event]
pub struct ProposalExecuted {
    pub proposal: Pubkey,
    pub executed_by: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct VotingPowerDelegated {
    pub dao: Pubkey,
    pub delegator: Pubkey,
    pub delegate: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DelegationRevoked {
    pub dao: Pubkey,
    pub delegator: Pubkey,
    pub delegate: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DaoConfigUpdated {
    pub dao: Pubkey,
    pub old_config: DaoConfig,
    pub new_config: DaoConfig,
}
```

## Errors

**Location**: `tickettoken/contracts/programs/governance/src/error.rs`

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum GovernanceError {
    #[msg("Insufficient tokens to create proposal")]
    InsufficientTokensToPropose,
    
    #[msg("Invalid voting period duration")]
    InvalidVotingPeriod,
    
    #[msg("Voting period is not currently active")]
    VotingPeriodNotActive,
    
    #[msg("Proposal is not active")]
    ProposalNotActive,
    
    #[msg("Insufficient voting power")]
    InsufficientVotingPower,
    
    #[msg("Unauthorized to cancel proposal")]
    UnauthorizedCancel,
    
    #[msg("Voting period has not ended")]
    VotingPeriodNotEnded,
    
    #[msg("Proposal has not passed")]
    ProposalNotPassed,
    
    #[msg("Execution delay requirement not met")]
    ExecutionDelayNotMet,
    
    #[msg("Unauthorized to execute proposal")]
    UnauthorizedExecution,
    
    #[msg("Insufficient tokens to delegate")]
    InsufficientTokensToDelegate,
    
    #[msg("Vote delegation is not allowed")]
    DelegationNotAllowed,
    
    #[msg("Unauthorized to revoke delegation")]
    UnauthorizedDelegationRevoke,
    
    #[msg("Voter has already voted on this proposal")]
    AlreadyVoted,
    
    #[msg("Proposal has already been executed")]
    AlreadyExecuted,
    
    #[msg("Invalid proposal instruction")]
    InvalidProposalInstruction,
    
    #[msg("Too many execution instructions")]
    TooManyInstructions,
    
    #[msg("Proposal execution failed")]
    ExecutionFailed,
    
    #[msg("Invalid quorum threshold")]
    InvalidQuorumThreshold,
    
    #[msg("Invalid approval threshold")]
    InvalidApprovalThreshold,
    
    #[msg("Vote delegation is locked during voting period")]
    DelegationLockedDuringVoting,
    
    #[msg("Cannot modify finalized proposal")]
    ProposalFinalized,
    
    #[msg("Invalid DAO configuration")]
    InvalidDaoConfig,
    
    #[msg("Governance token account mismatch")]
    TokenAccountMismatch,
    
    #[msg("Voting power calculation overflow")]
    VotingPowerOverflow,
}
```

## Usage Examples

### Initialize a DAO

```typescript
const daoConfig = {
  minTokensToPropose: new BN(1_000_000), // 1M tokens
  quorumThresholdBps: 1000,              // 10%
  approvalThresholdBps: 5000,            // 50%
  minVotingPeriod: new BN(3 * 24 * 60 * 60), // 3 days
  maxVotingPeriod: new BN(14 * 24 * 60 * 60), // 14 days
  discussionPeriod: new BN(24 * 60 * 60),     // 1 day
  executionDelay: new BN(2 * 24 * 60 * 60),   // 2 days
  autoExecutePassedProposals: false,
  allowVoteDelegation: true,
  lockTokensDuringVote: true,
  maxExecutionInstructions: 10,
};

await governanceProgram.methods
  .initializeDao(daoConfig)
  .accounts({
    dao: daoPDA,
    governanceTokenMint: governanceTokenMint.publicKey,
    treasury: treasuryPDA,
    authority: authority.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([authority])
  .rpc();
```

### Create a Proposal

```typescript
const title = "Update Platform Fees";
const description = "Proposal to reduce platform fees from 2.5% to 2.0%";
const proposalType = { parameterUpdate: {} };
const votingPeriod = new BN(7 * 24 * 60 * 60); // 7 days

// Create instruction to update fees
const executionInstructions = [
  {
    instructionType: { configUpdate: {} },
    programId: marketplaceProgramId,
    accounts: [
      { pubkey: configPDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([/* serialized update instruction */]),
  },
];

await governanceProgram.methods
  .createProposal(
    title,
    description,
    proposalType,
    executionInstructions,
    votingPeriod
  )
  .accounts({
    dao: daoPDA,
    proposal: proposalPDA,
    proposerTokenAccount: proposerTokenAccount,
    proposer: proposer.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([proposer])
  .rpc();
```

### Cast a Vote

```typescript
const voteType = { for: {} }; // or { against: {} } or { abstain: {} }

await governanceProgram.methods
  .castVote(voteType, null) // null = use full token balance
  .accounts({
    dao: daoPDA,
    proposal: proposalPDA,
    vote: votePDA,
    voterTokenAccount: voterTokenAccount,
    voter: voter.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([voter])
  .rpc();
```

### Delegate Voting Power

```typescript
const delegationAmount = new BN(500_000); // 500K tokens

await governanceProgram.methods
  .delegateVotingPower(delegationAmount)
  .accounts({
    dao: daoPDA,
    delegation: delegationPDA,
    delegatorTokenAccount: delegatorTokenAccount,
    delegationEscrow: delegationEscrowAccount,
    delegate: delegate.publicKey,
    delegator: delegator.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([delegator])
  .rpc();
```

### Finalize and Execute Proposal

```typescript
// First finalize voting
await governanceProgram.methods
  .finalizeProposal()
  .accounts({
    dao: daoPDA,
    proposal: proposalPDA,
  })
  .rpc();

// Then execute if passed
await governanceProgram.methods
  .executeProposal()
  .accounts({
    dao: daoPDA,
    proposal: proposalPDA,
    executor: executor.publicKey,
  })
  .remainingAccounts([
    // Add accounts needed for proposal execution
    { pubkey: configPDA, isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: false, isWritable: false },
  ])
  .signers([executor])
  .rpc();
```

## Integration Points

### With Treasury Program
- **Fund Management**: Governance controls treasury spending
- **Proposal Execution**: Treasury operations require governance approval
- **Multi-signature**: Large expenditures need proposal consensus

### With Other Platform Programs
- **Configuration Updates**: Change parameters via governance
- **Feature Toggles**: Enable/disable features through proposals
- **Emergency Actions**: Pause operations in crisis situations

### With Token Program
- **Voting Power**: Based on governance token holdings
- **Token Locking**: Prevent transfers during voting
- **Delegation**: Transfer voting rights to other accounts

## Security Features

1. **Multi-tiered Voting**: Different thresholds for different proposal types
2. **Time Delays**: Execution delays prevent fast attacks
3. **Quorum Requirements**: Minimum participation for validity
4. **Cancel Mechanisms**: Proposers and authorities can cancel proposals
5. **Delegation Limits**: Controlled vote delegation system
6. **Instruction Validation**: Verify execution instructions before running

## Governance Best Practices

### Proposal Creation
- Clear, detailed descriptions
- Reasonable voting periods
- Proper categorization
- Community discussion before formal proposal

### Voting Guidelines
- Informed decision making
- Consider long-term platform health
- Abstain if uncertain
- Participate in community discussion

### Execution Safety
- Thorough testing on devnet
- Gradual rollouts for major changes
- Monitoring post-implementation
- Rollback procedures for failures

## Testing

Tests are located in `tickettoken/contracts/tests/governance.ts`

```bash
cd tickettoken/contracts
anchor test -- --features governance
```

### Test Coverage
- ✅ DAO initialization
- ✅ Proposal creation and validation
- ✅ Voting mechanisms and power calculation
- ✅ Delegation and revocation
- ✅ Proposal finalization and execution
- ✅ Configuration updates
- ✅ Error conditions and edge cases

## Analytics and Monitoring

### Key Metrics
- Proposal creation rate
- Voter participation rates
- Delegation patterns
- Execution success rates
- Token distribution analysis

### Governance Health Indicators
- Active voter count
- Proposal success rate
- Average participation
- Voting power concentration
- Decision turnaround time

## Deployment

### Environment Setup
```toml
# Anchor.toml
[programs.localnet]
governance = "Govern..."

[programs.devnet]
governance = "Govern..."

[programs.mainnet]
governance = "Govern..."
```

### Deployment Steps
1. Deploy governance token contract
2. Initialize DAO with proper configuration
3. Transfer initial authority to DAO
4. Create initial proposals for bootstrapping
5. Distribute governance tokens to community

## Future Enhancements

### Planned Features
1. **Quadratic Voting**: Reduce whale influence
2. **Multi-token Governance**: Support multiple governance tokens
3. **Liquid Democracy**: Fluid delegation chains
4. **Conviction Voting**: Time-based voting weight
5. **Shielded Voting**: Private vote casting
6. **Cross-DAO Proposals**: Inter-DAO collaboration

### Technical Improvements
1. **Gas Optimization**: Reduce transaction costs
2. **Snapshot Integration**: Off-chain voting with on-chain execution
3. **Advanced Analytics**: Comprehensive governance metrics
4. **Mobile Integration**: Mobile-friendly voting interfaces

## Migration and Upgrades

### DAO Configuration Updates
- Use governance proposals for configuration changes
- Gradual parameter adjustments
- Community consensus building
- Fallback mechanisms for emergencies

### Program Upgrades
- Governance-controlled upgrade authority
- Multi-stage upgrade process
- Community review periods
- Emergency upgrade procedures

## Conclusion

The Governance program provides a comprehensive framework for decentralized decision-making on the TicketToken platform. With features like token-weighted voting, delegation, execution delays, and multi-tiered proposal types, it ensures secure and democratic governance of the platform.

The system is designed to be flexible and upgradeable through its own governance mechanisms, allowing the community to evolve the platform over time while maintaining security and decentralization.

---

**Related Documentation:**
- [Treasury Program](../treasury/README.md)
- [Staking Program](../staking/README.md)
- [Main Contracts Documentation](../../README.md)
