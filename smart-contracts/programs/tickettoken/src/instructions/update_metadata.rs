use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
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

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateMetadata>,
    new_metadata: TicketMetadata,
) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(new_metadata.name.len() <= 32, TicketTokenError::InvalidMetadata);
    require!(new_metadata.description.len() <= 256, TicketTokenError::InvalidMetadata);
    require!(new_metadata.venue.len() <= 64, TicketTokenError::InvalidVenue);
    
    // Update metadata
    ticket_data.metadata = new_metadata;
    
    msg!("Ticket metadata updated successfully for mint: {}", ticket_data.mint);
    Ok(())
}
