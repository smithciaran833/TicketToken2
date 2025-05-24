use anchor_lang::prelude::*;

use crate::state::{StakingProgram, StakingConfig};

#[derive(Accounts)]
pub struct InitializeStaking<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The staking program account (PDA)
    #[account(
        init,
        payer = authority,
        space = StakingProgram::LEN,
        seeds = [b"staking_program"],
        bump
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeStaking>,
    config: StakingConfig,
) -> Result<()> {
    let staking_program = &mut ctx.accounts.staking_program;
    
    staking_program.authority = ctx.accounts.authority.key();
    staking_program.config = config;
    staking_program.active_pools = 0;
    staking_program.total_staked = 0;
    staking_program.bump = *ctx.bumps.get("staking_program").unwrap();
    
    msg!("Staking program initialized by {}", ctx.accounts.authority.key());
    
    Ok(())
}
