use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
#[instruction(content_id: String)]
pub struct GrantContentAccess<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
        constraint = program_state.authority == authority.key() @ TicketTokenError::Unauthorized,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(
        constraint = owner_token_account.mint == ticket_data.mint @ TicketTokenError::TicketMintMismatch,
        constraint = owner_token_account.owner == ticket_data.owner @ TicketTokenError::TokenAccountMismatch,
        constraint = owner_token_account.amount == 1 @ TicketTokenError::InvalidTokenAmount,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<GrantContentAccess>,
    content_id: String,
    access_level: AccessLevel,
) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(!ticket_data.is_used, TicketTokenError::TicketAlreadyUsed);
    require!(content_id.len() <= 64, TicketTokenError::InvalidEventId);
    
    // Check if content access already exists
    let existing_access = ticket_data.content_access
        .iter_mut()
        .find(|access| access.content_id == content_id);
    
    if let Some(access) = existing_access {
        // Update existing access
        access.access_level = access_level.clone();
        access.is_active = true;
        access.expiry_timestamp = None; // Remove expiry when granted by authority
    } else {
        // Add new content access
        let new_access = ContentAccess {
            content_id: content_id.clone(),
            access_level: access_level.clone(),
            expiry_timestamp: None,
            is_active: true,
        };
        
        ticket_data.content_access.push(new_access);
    }
    
    emit!(ContentAccessGranted {
        mint: ticket_data.mint,
        owner: ticket_data.owner,
        content_id,
        access_level,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Content access granted successfully");
    Ok(())
}
