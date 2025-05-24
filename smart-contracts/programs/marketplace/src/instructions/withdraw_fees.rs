use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        constraint = marketplace.admin == admin.key() @ MarketplaceError::UnauthorizedAdmin
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        mut,
        seeds = [b"fee_vault", marketplace.key().as_ref()],
        bump,
        constraint = fee_vault.accumulated_fees > 0 @ MarketplaceError::NoFeesToWithdraw
    )]
    pub fee_vault: Account<'info, FeeVault>,

    #[account(
        mut,
        constraint = vault_token_account.owner == fee_vault.key() @ MarketplaceError::InvalidVaultTokenAccount
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_token_account.owner == marketplace.treasury @ MarketplaceError::InvalidTreasuryTokenAccount
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawParams {
    pub amount: Option<u64>, // None for full withdrawal
    pub distribution: FeeDistribution,
}

pub fn withdraw_fees(ctx: Context<WithdrawFees>, params: WithdrawParams) -> Result<()> {
    let fee_vault = &mut ctx.accounts.fee_vault;
    let marketplace = &ctx.accounts.marketplace;
    let clock = Clock::get()?;

    // Calculate withdrawal amount
    let withdrawal_amount = params.amount.unwrap_or(fee_vault.accumulated_fees);
    
    require!(
        withdrawal_amount <= fee_vault.accumulated_fees,
        MarketplaceError::InsufficientFees
    );

    require!(
        withdrawal_amount <= ctx.accounts.vault_token_account.amount,
        MarketplaceError::InsufficientVaultBalance
    );

    // Create signer seeds
    let marketplace_key = marketplace.key();
    let seeds = &[b"fee_vault", marketplace_key.as_ref(), &[fee_vault.bump]];
    let signer = &[&seeds[..]];

    // Transfer fees to treasury
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.treasury_token_account.to_account_info(),
        authority: fee_vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, withdrawal_amount)?;

    // Update fee vault state
    fee_vault.accumulated_fees -= withdrawal_amount;
    fee_vault.total_withdrawn += withdrawal_amount;
    fee_vault.last_withdrawal_at = clock.unix_timestamp;
    fee_vault.withdrawal_count += 1;

    // Log withdrawal in history
    fee_vault.withdrawal_history.push(FeeWithdrawal {
        amount: withdrawal_amount,
        timestamp: clock.unix_timestamp,
        admin: ctx.accounts.admin.key(),
        distribution: params.distribution.clone(),
    });

    // Emit withdrawal event
    emit!(FeesWithdrawnEvent {
        marketplace: marketplace.key(),
        amount: withdrawal_amount,
        admin: ctx.accounts.admin.key(),
        remaining_fees: fee_vault.accumulated_fees,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
