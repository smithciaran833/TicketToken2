use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
#[instruction(content_id: String)]
pub struct VerifyOwnership<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
        constraint = ticket_data.owner == owner.key() @ TicketTokenError::NotTicketOwner,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(
        constraint = owner_token_account.mint == ticket_data.mint @ TicketTokenError::TicketMintMismatch,
        constraint = owner_token_account.owner == owner.key() @ TicketTokenError::TokenAccountMismatch,
        constraint = owner_token_account.amount == 1 @ TicketTokenError::InvalidTokenAmount,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
}

pub fn handler(
    ctx: Context<VerifyOwnership>,
    content_id: String,
) -> Result<()> {
    let ticket_data = &ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(!ticket_data.is_used, TicketTokenError::TicketAlreadyUsed);
    
    // Find the content access for this content_id
    let content_access = ticket_data.content_access
        .iter()
        .find(|access| access.content_id == content_id)
        .ok_or(TicketTokenError::ContentAccessNotFound)?;
    
    require!(content_access.is_active, TicketTokenError::ContentAccessNotFound);
    
    // Check if access has expired
    if let Some(expiry) = content_access.expiry_timestamp {
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < expiry, TicketTokenError::ContentAccessExpired);
    }
    
    msg!(
        "Ownership verified for ticket {} and content {}",
        ticket_data.mint,
        content_id
    );
    
    Ok(())
}
