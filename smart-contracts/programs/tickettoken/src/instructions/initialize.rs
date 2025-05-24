use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProgramState::LEN,
        seeds = [b"program_state"],
        bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeProgram>,
    program_authority: Pubkey,
    marketplace_fee_bps: u16,
    royalty_fee_bps: u16,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    
    require!(marketplace_fee_bps <= 1000, TicketTokenError::InvalidFeePercentage); // Max 10%
    require!(royalty_fee_bps <= 1000, TicketTokenError::InvalidFeePercentage); // Max 10%
    
    program_state.authority = program_authority;
    program_state.marketplace_fee_bps = marketplace_fee_bps;
    program_state.royalty_fee_bps = royalty_fee_bps;
    program_state.is_paused = false;
    program_state.total_tickets_minted = 0;
    program_state.bump = *ctx.bumps.get("program_state").unwrap();
    
    msg!("TicketToken program initialized with authority: {}", program_authority);
    Ok(())
}
