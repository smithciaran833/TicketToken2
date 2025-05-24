use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint};

use crate::state::{Governance, Proposal, ProposalState, VoteType, Vote, VoterWeight};
use crate::errors::GovernanceError;

#[derive(Accounts)]
#[instruction(vote_type: VoteType)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    
    /// The governance account
    #[account(
        seeds = [b"governance", governance.governance_token_mint.as_ref()],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    /// The governance token mint
    pub governance_token_mint: Account<'info, Mint>,
    
    /// The proposal being voted on
    #[account(
        mut,
        seeds = [b"proposal", governance.key().as_ref(), &proposal.id.to_le_bytes()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,
    
    /// Voter's governance token account
    #[account(
        constraint = voter_token_account.mint == governance.governance_token_mint,
        constraint = voter_token_account.owner == voter.key()
    )]
    pub voter_token_account: Account<'info, TokenAccount>,
    
    /// Voter's weight account
    #[account(
        init_if_needed,
        payer = voter,
        space = VoterWeight::LEN,
        seeds = [b"voter_weight", governance.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub voter_weight: Account<'info, VoterWeight>,
    
    /// The vote record
    #[account(
        init,
        payer = voter,
        space = Vote::LEN,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote: Account<'info, Vote>,
    
    /// If the voter has delegated, the delegate's voter weight account
    #[account(
        mut,
        seeds = [b"voter_weight", governance.key().as_ref(), voter_weight.delegate.unwrap_or(voter.key()).as_ref()],
        bump = delegate_voter_weight.bump,
    )]
    pub delegate_voter_weight: Option<Account<'info, VoterWeight>>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CastVote>,
    vote_type: VoteType,
    vote_weight: Option<u64>,
) -> Result<()> {
    let governance = &ctx.accounts.governance;
    let proposal = &mut ctx.accounts.proposal;
    let voter_weight_account = &mut ctx.accounts.voter_weight;
    let vote = &mut ctx.accounts.vote;
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if proposal is in voting state
    require!(
        proposal.is_active(current_time),
        GovernanceError::VotingEnded
    );
    
    // Initialize voter weight if needed
    if voter_weight_account.voter != ctx.accounts.voter.key() {
        voter_weight_account.governance = governance.key();
        voter_weight_account.voter = ctx.accounts.voter.key();
        voter_weight_account.weight = ctx.accounts.voter_token_account.amount;
        voter_weight_account.delegate = None;
        voter_weight_account.delegated_weight = 0;
        voter_weight_account.last_proposal_time = 0;
        voter_weight_account.bump = *ctx.bumps.get("voter_weight").unwrap();
    }
    
    // Determine effective voting weight
    let effective_weight = if let Some(delegate_weight_account) = &mut ctx.accounts.delegate_voter_weight {
        // Voter has delegated their votes
        delegate_weight_account.effective_weight()
    } else {
        // Voter is voting directly
        voter_weight_account.effective_weight()
    };
    
    // Apply proposal-specific weight multipliers
    let final_vote_weight = proposal.calculate_voting_power_for_type(effective_weight);
    
    // Validate vote weight if specified
    if let Some(specified_weight) = vote_weight {
        require!(
            specified_weight <= final_vote_weight,
            GovernanceError::InvalidVoteWeight
        );
    }
    
    let actual_vote_weight = vote_weight.unwrap_or(final_vote_weight);
    
    // Record the vote
    vote.proposal = proposal.key();
    vote.voter = ctx.accounts.voter.key();
    vote.vote_type = vote_type;
    vote.weight = actual_vote_weight;
    vote.voted_at = current_time;
    vote.bump = *ctx.bumps.get("vote").unwrap();
    
    // Update proposal vote counts
    match vote_type {
        VoteType::Yes => proposal.yes_votes += actual_vote_weight,
        VoteType::No => proposal.no_votes += actual_vote_weight,
        VoteType::Abstain => proposal.abstain_votes += actual_vote_weight,
    }
    
    proposal.total_votes += actual_vote_weight;
    proposal.voter_count += 1;
    
    // Check if proposal state needs updating
    let total_supply = ctx.accounts.governance_token_mint.supply;
    proposal.update_state(governance, current_time, total_supply);
    
    msg!(
        "Vote cast: {} voted {} on proposal {} with weight {}",
        ctx.accounts.voter.key(),
        match vote_type {
            VoteType::Yes => "YES",
            VoteType::No => "NO",
            VoteType::Abstain => "ABSTAIN",
        },
        proposal.id,
        actual_vote_weight
    );
    
    Ok(())
}
