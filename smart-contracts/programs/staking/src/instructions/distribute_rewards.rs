use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Token};

use crate::state::{StakingProgram, StakePool};
use crate::errors::StakingError;

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DistributeRewards<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The staking program account
    #[account(
        seeds = [b"staking_program"],
        bump = staking_program.bump,
        constraint = staking_program.authority == authority.key() @ StakingError::InvalidAuthority
    )]
    pub staking_program: Account<'info, StakingProgram>,
    
    /// The stake pool to distribute rewards to
    #[account(
        mut,
        constraint = stake_pool.active @ StakingError::StakePoolNotActive
    )]
    pub stake_pool: Account<'info, StakePool>,
    
    /// Authority's token account (source of reward tokens)
    #[account(
        mut,
        constraint = authority_reward_account.mint == stake_pool.reward_token_mint,
        constraint = authority_reward_account.owner == authority.key(),
        constraint = authority_reward_account.amount >= amount @ StakingError::InsufficientRewards
    )]
    pub authority_reward_account: Account<'info, TokenAccount>,
    
    /// Vault to receive reward tokens
    #[account(
        mut,
        constraint = reward_vault.key() == stake_pool.reward_vault
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DistributeRewards>, amount: u64) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    
    require!(amount > 0, StakingError::InvalidStakeAmount);
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Update pool rewards before adding new rewards
    stake_pool.update_rewards(current_time)?;
    
    // Transfer reward tokens from authority to reward vault
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.authority_reward_account.to_account_info(),
        to: ctx.accounts.reward_vault.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    
    // Update available rewards
    stake_pool.available_rewards = stake_pool.available_rewards
        .checked_add(amount)
        .unwrap();
    
    msg!(
        "Distributed {} reward tokens to pool {}",
        amount,
        stake_pool.pool_id
    );
    
    Ok(())
}
