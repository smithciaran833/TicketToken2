use anchor_lang::prelude::*;

use crate::state::StakingProgram;
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(paused: bool)]
pub struct EmergencyPause<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The staking program account
    #[account(
        mut,
        seeds = [b"staking_program"],
        bump = staking_program.bump,
        constraint = staking_program.authority == authority.key() @ StakingError::InvalidAuthority
    )]
    pub staking_program: Account<'info, StakingProgram>,
}

pub fn handler(ctx: Context<EmergencyPause>, paused: bool) -> Result<()> {
    let staking_program = &mut ctx.accounts.staking_program;
    
    staking_program.config.paused = paused;
    
    msg!(
        "Staking program {} by {}",
        if paused { "PAUSED" } else { "UNPAUSED" },
        ctx.accounts.authority.key()
    );
    
    Ok(())
}
