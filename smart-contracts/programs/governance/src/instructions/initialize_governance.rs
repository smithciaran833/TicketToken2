use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::state::{Governance, GovernanceConfig};

#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The governance token mint
    pub governance_token_mint: Account<'info, Mint>,
    
    /// The governance account (PDA)
    #[account(
        init,
        payer = authority,
        space = Governance::LEN,
        seeds = [b"governance", governance_token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeGovernance>,
    config: GovernanceConfig,
) -> Result<()> {
    let governance = &mut ctx.accounts.governance;
    
    governance.authority = ctx.accounts.authority.key();
    governance.governance_token_mint = ctx.accounts.governance_token_mint.key();
    governance.config = config;
    governance.proposal_count = 0;
    governance.bump = *ctx.bumps.get("governance").unwrap();
    
    msg!("Governance initialized for mint: {}", ctx.accounts.governance_token_mint.key());
    
    Ok(())
}
