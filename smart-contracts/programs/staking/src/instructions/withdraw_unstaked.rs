use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Token};

use crate::state::{StakePool, UserStake};
use crate::errors::StakingError;

#[derive(Accounts)]
pub struct WithdrawUnstaked<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// The stake pool
    #[account(
        seeds = [b"stake_pool", stake_pool.staking_program.as_ref(), &stake_pool.pool_id.to_le_bytes()],
        bump = stake_pool.bump
    )]
    pub stake_pool: Account<'info, StakePool>,
    
    /// User's stake account
    #[account(
        mut,
        seeds = [b"user_stake", stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.user == user.key()
    )]
    pub user_stake: Account<'info, UserStake>,
    
    /// User's token account (destination for withdrawn tokens)
    #[account(
        mut,
        constraint = user_token_account.mint == stake_pool.stake_token_mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Vault holding staked tokens
    #[account(
        mut,
        constraint = stake_vault.key() == stake_pool.stake_vault
    )]
    pub stake_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawUnstaked>) -> Result<()> {
    let stake_pool = &ctx.accounts.stake_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if user has unstaking request and cooldown has ended
    require!(
        user_stake.unstake_request.is_some(),
        StakingError::NothingToWithdraw
    );
    
    require!(
        user_stake.can_withdraw_unstaked(current_time),
        StakingError::CooldownNotEnded
    );
    
    let unstake_request = user_stake.unstake_request.unwrap();
    let withdraw_amount = unstake_request.amount;
    
    // Create PDA signer for stake pool authority
    let staking_program_key = stake_pool.staking_program;
    let pool_id_bytes = stake_pool.pool_id.to_le_bytes();
    let seeds = &[
        b"stake_pool",
        staking_program_key.as_ref(),
        &pool_id_bytes,
        &[stake_pool.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Transfer tokens from stake vault to user
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.stake_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, withdraw_amount)?;
    
    // Clear the unstake request
    user_stake.unstake_request = None;
    
    msg!(
        "User {} withdrew {} unstaked tokens from pool {}",
        ctx.accounts.user.key(),
        withdraw_amount,
        stake_pool.pool_id
    );
    
    Ok(())
}
