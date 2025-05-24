use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint};

use crate::state::{Governance, VoterWeight, VoteDelegation};
use crate::errors::GovernanceError;

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,
    
    /// The governance account
    #[account(
        seeds = [b"governance", governance.governance_token_mint.as_ref()],
        bump = governance.bump
    )]
    pub governance: Account<'info, Governance>,
    
    /// The governance token mint
    pub governance_token_mint: Account<'info, Mint>,
    
    /// Delegator's governance token account
    #[account(
        constraint = delegator_token_account.mint == governance.governance_token_mint,
        constraint = delegator_token_account.owner == delegator.key()
    )]
    pub delegator_token_account: Account<'info, TokenAccount>,
    
    /// Delegator's voter weight account
    #[account(
        mut,
        seeds = [b"voter_weight", governance.key().as_ref(), delegator.key().as_ref()],
        bump = delegator_voter_weight.bump
    )]
    pub delegator_voter_weight: Account<'info, VoterWeight>,
    
    /// Delegate's voter weight account
    #[account(
        mut,
        seeds = [b"voter_weight", governance.key().as_ref(), delegator_voter_weight.delegate.unwrap().as_ref()],
        bump = delegate_voter_weight.bump
    )]
    pub delegate_voter_weight: Account<'info, VoterWeight>,
    
    /// The delegation record to be closed
    #[account(
        mut,
        close = delegator,
        seeds = [b"delegation", governance.key().as_ref(), delegator.key().as_ref()],
        bump = delegation.bump,
        constraint = delegation.delegator == delegator.key(),
    )]
    pub delegation: Account<'info, VoteDelegation>,
}

pub fn handler(ctx: Context<RevokeDelegation>) -> Result<()> {
    let delegator_voter_weight = &mut ctx.accounts.delegator_voter_weight;
    let delegate_voter_weight = &mut ctx.accounts.delegate_voter_weight;
    
    // Check if delegation exists
    require!(
        delegator_voter_weight.delegate.is_some(),
        GovernanceError::InvalidDelegation
    );
    
    // Get the delegated amount
    let delegated_amount = delegator_voter_weight.weight;
    
    // Remove delegation from delegator
    delegator_voter_weight.delegate = None;
    
    // Remove delegated weight from delegate
    delegate_voter_weight.delegated_weight = delegate_voter_weight
        .delegated_weight
        .checked_sub(delegated_amount)
        .ok_or(GovernanceError::MathOverflow)?;
    
    msg!(
        "Vote delegation revoked: {} revoked {} voting power from {}",
        ctx.accounts.delegator.key(),
        delegated_amount,
        delegate_voter_weight.voter
    );
    
    // The delegation account will be automatically closed due to the `close` constraint
    
    Ok(())
}
