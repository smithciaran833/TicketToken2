use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct UseTicket<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
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

    /// CHECK: Event verifier account (could be event organizer)
    pub verifier: Signer<'info>,
}

pub fn handler(
    ctx: Context<UseTicket>,
    verification_code: String,
) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(!ticket_data.is_used, TicketTokenError::TicketAlreadyUsed);
    require!(!ticket_data.is_listed, TicketTokenError::TicketCurrentlyListed);
    require!(verification_code.len() > 0, TicketTokenError::InvalidVerificationCode);
    
    let current_time = Clock::get()?.unix_timestamp;
    
    // Check if event has started (basic validation)
    require!(
        current_time >= ticket_data.metadata.event_datetime - 3600, // Allow 1 hour early
        TicketTokenError::EventNotStarted
    );
    
    // Check if event hasn't ended (24 hours after start)
    require!(
        current_time <= ticket_data.metadata.event_datetime + 86400,
        TicketTokenError::EventEnded
    );
    
    // Simple verification code check (in production, this would be more sophisticated)
    let expected_code = format!("{}_{}", ticket_data.event_id, ticket_data.mint.to_string()[..8].to_string());
    require!(
        verification_code == expected_code,
        TicketTokenError::InvalidVerificationCode
    );
    
    // Mark ticket as used
    ticket_data.is_used = true;
    ticket_data.usage_timestamp = Some(current_time);
    
    emit!(TicketUsed {
        mint: ticket_data.mint,
        owner: ticket_data.owner,
        event_id: ticket_data.event_id.clone(),
        timestamp: current_time,
    });
    
    msg!(
        "Ticket used successfully for event: {} at {}",
        ticket_data.event_id,
        current_time
    );
    
    Ok(())
}
