use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct SetProgramPause<'info> {
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
    ctx: Context<SetProgramPause>,
    paused: bool,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    
    program_state.is_paused = paused;
    
    msg!(
        "Program {} by authority: {}",
        if paused { "paused" } else { "unpaused" },
        ctx.accounts.authority.key()
    );
    
    Ok(())
}
