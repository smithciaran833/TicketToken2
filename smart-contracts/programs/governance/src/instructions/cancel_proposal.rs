use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::state::{Governance, Proposal, ProposalState};
use crate::errors::GovernanceError;

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The governance account
    #[account(
        seeds = [b"governance", governance.governance_token_mint.as_ref()],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    /// The governance token mint
    pub governance_token_mint: Account<'info, Mint>,
    
    /// The proposal to cancel
    #[account(
        mut,
        seeds = [b"proposal", governance.key().as_ref(), &proposal.id.to_le_bytes()],
        bump = proposal.bump
    )]
    pub proposal: Account<'info, Proposal>,
}

pub fn handler(ctx: Context<CancelProposal>) -> Result<()> {
    let governance = &ctx.accounts.governance;
    let proposal = &mut ctx.accounts.proposal;
    let authority = &ctx.accounts.authority;
    
    // Check if proposal can be canceled
    require!(
        proposal.state != ProposalState::Executed,
        GovernanceError::CannotCancelExecuted
    );
    
    // Check authorization - only proposal creator or governance authority can cancel
    let can_cancel = authority.key() == proposal.proposer || 
                    authority.key() == governance.authority;
    
    require!(can_cancel, GovernanceError::UnauthorizedCancel);
    
    // Update proposal state
    proposal.state = ProposalState::Canceled;
    
    msg!(
        "Proposal {} canceled by {}",
        proposal.id,
        authority.key()
    );
    
    Ok(())
}
