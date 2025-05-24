use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint};

use crate::state::{Governance, Proposal, ProposalType, ProposalState, VoterWeight};
use crate::errors::GovernanceError;

#[derive(Accounts)]
#[instruction(proposal_type: ProposalType, title: String, description: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    
    /// The governance account
    #[account(
        mut,
        seeds = [b"governance", governance.governance_token_mint.as_ref()],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    /// The governance token mint
    pub governance_token_mint: Account<'info, Mint>,
    
    /// Proposer's governance token account
    #[account(
        constraint = proposer_token_account.mint == governance.governance_token_mint,
        constraint = proposer_token_account.owner == proposer.key()
    )]
    pub proposer_token_account: Account<'info, TokenAccount>,
    
    /// Proposer's voter weight account
    #[account(
        init_if_needed,
        payer = proposer,
        space = VoterWeight::LEN,
        seeds = [b"voter_weight", governance.key().as_ref(), proposer.key().as_ref()],
        bump
    )]
    pub proposer_voter_weight: Account<'info, VoterWeight>,
    
    /// The proposal account to be created
    #[account(
        init,
        payer = proposer,
        space = Proposal::LEN,
        seeds = [b"proposal", governance.key().as_ref(), &governance.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    
    /// For event-specific proposals, the event account
    pub related_event: Option<AccountInfo<'info>>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateProposal>,
    proposal_type: ProposalType,
    title: String,
    description: String,
    execution_instructions: Vec<u8>,
) -> Result<()> {
    let governance = &mut ctx.accounts.governance;
    let proposal = &mut ctx.accounts.proposal;
    let proposer_voter_weight = &mut ctx.accounts.proposer_voter_weight;
    
    // Validate input lengths
    require!(
        title.len() <= Proposal::MAX_TITLE_LEN,
        GovernanceError::TitleTooLong
    );
    require!(
        description.len() <= Proposal::MAX_DESCRIPTION_LEN,
        GovernanceError::DescriptionTooLong
    );
    require!(
        execution_instructions.len() <= Proposal::MAX_EXECUTION_INSTRUCTIONS_LEN,
        GovernanceError::InvalidExecutionInstructions
    );
    
    // Check proposer has enough tokens to create proposal
    let proposer_token_balance = ctx.accounts.proposer_token_account.amount;
    require!(
        proposer_token_balance >= governance.config.proposal_threshold,
        GovernanceError::InsufficientVotingPower
    );
    
    // Check cooldown period (if voter weight exists)
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    if proposer_voter_weight.voter == ctx.accounts.proposer.key() {
        let time_since_last_proposal = current_time - proposer_voter_weight.last_proposal_time;
        require!(
            time_since_last_proposal >= governance.config.proposal_cooldown,
            GovernanceError::InvalidProposalDuration
        );
    } else {
        // Initialize voter weight if this is first time
        proposer_voter_weight.governance = governance.key();
        proposer_voter_weight.voter = ctx.accounts.proposer.key();
        proposer_voter_weight.weight = proposer_token_balance;
        proposer_voter_weight.delegate = None;
        proposer_voter_weight.delegated_weight = 0;
        proposer_voter_weight.bump = *ctx.bumps.get("proposer_voter_weight").unwrap();
    }
    
    // Update last proposal time
    proposer_voter_weight.last_proposal_time = current_time;
    
    // Set voting duration based on proposal type
    let voting_duration = match proposal_type {
        ProposalType::Emergency => governance.config.voting_duration / 2, // Half the normal duration
        _ => governance.config.voting_duration,
    };
    
    // Initialize proposal
    proposal.governance = governance.key();
    proposal.id = governance.proposal_count;
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.proposal_type = proposal_type;
    proposal.state = ProposalState::Active;
    proposal.title = title;
    proposal.description = description;
    proposal.execution_instructions = execution_instructions;
    proposal.created_at = current_time;
    proposal.voting_start_time = current_time;
    proposal.voting_end_time = current_time + voting_duration;
    proposal.execution_start_time = current_time + voting_duration;
    proposal.execution_end_time = current_time + voting_duration + governance.config.execution_window;
    proposal.yes_votes = 0;
    proposal.no_votes = 0;
    proposal.abstain_votes = 0;
    proposal.total_votes = 0;
    proposal.voter_count = 0;
    proposal.related_event = ctx.accounts.related_event.map(|e| e.key());
    proposal.bump = *ctx.bumps.get("proposal").unwrap();
    
    // Increment proposal count
    governance.proposal_count += 1;
    
    msg!(
        "Proposal {} created: {} by {}",
        proposal.id,
        proposal.title,
        proposal.proposer
    );
    
    Ok(())
}
