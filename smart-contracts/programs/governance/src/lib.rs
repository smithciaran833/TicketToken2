use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;
use state::*;
use errors::*;

declare_id!("Governance111111111111111111111111111111111111");

#[program]
pub mod ticket_governance {
    use super::*;

    /// Initialize the governance system
    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        config: GovernanceConfig,
    ) -> Result<()> {
        instructions::initialize_governance::handler(ctx, config)
    }

    /// Create a new proposal
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        proposal_type: ProposalType,
        title: String,
        description: String,
        execution_instructions: Vec<u8>,
    ) -> Result<()> {
        instructions::create_proposal::handler(ctx, proposal_type, title, description, execution_instructions)
    }

    /// Cast a vote on a proposal
    pub fn cast_vote(
        ctx: Context<CastVote>,
        vote_type: VoteType,
        vote_weight: Option<u64>,
    ) -> Result<()> {
        instructions::cast_vote::handler(ctx, vote_type, vote_weight)
    }

    /// Execute a proposal that has passed
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        instructions::execute_proposal::handler(ctx)
    }

    /// Delegate voting power to another account
    pub fn delegate_votes(
        ctx: Context<DelegateVotes>,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::delegate_votes::handler(ctx, delegate)
    }

    /// Remove vote delegation
    pub fn revoke_delegation(ctx: Context<RevokeDelegation>) -> Result<()> {
        instructions::revoke_delegation::handler(ctx)
    }

    /// Cancel a proposal (only by creator or governance authority)
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        instructions::cancel_proposal::handler(ctx)
    }
}
