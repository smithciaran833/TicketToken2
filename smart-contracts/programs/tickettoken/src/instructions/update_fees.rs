use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    #[account(
        mut,
        seeds = [b"program_state"],
        bump = program_state.bump,
        constraint = program_state.authority == authority.key() @ TicketTokenError::Unauthorized,
    )]
    pub program_state: Account<'info, ProgramState>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateFees>,
    marketplace_fee_bps: u16,
    royalty_fee_bps: u16,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    
    require!(marketplace_fee_bps <= 1000, TicketTokenError::InvalidFeePercentage); // Max 10%
    require!(royalty_fee_bps <= 1000, TicketTokenError::InvalidFeePercentage); // Max 10%
    
    program_state.marketplace_fee_bps = marketplace_fee_bps;
    program_state.royalty_fee_bps = royalty_fee_bps;
    
    msg!(
        "Fees updated - Marketplace: {}bps, Royalty: {}bps by authority: {}",
        marketplace_fee_bps,
        royalty_fee_bps,
        ctx.accounts.authority.key()
    );
    
    Ok(())
}
