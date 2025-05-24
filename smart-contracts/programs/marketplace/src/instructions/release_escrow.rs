// File: contracts/programs/marketplace/src/instructions/release_escrow.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = escrow.state == EscrowState::Active @ MarketplaceError::EscrowNotActive,
        constraint = authority.key() == escrow.buyer || authority.key() == escrow.seller || authority.key() == escrow.arbitrator @ MarketplaceError::UnauthorizedRelease
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow.key() @ MarketplaceError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.owner == escrow.seller @ MarketplaceError::InvalidSellerTokenAccount
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = platform_token_account.owner == platform_treasury.key() @ MarketplaceError::InvalidPlatformTokenAccount
    )]
    pub platform_token_account: Account<'info, TokenAccount>,

    /// CHECK: Platform treasury account
    pub platform_treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ReleaseParams {
    pub release_type: ReleaseType,
    pub partial_amount: Option<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum ReleaseType {
    Full,
    Partial,
    Dispute,
}

pub fn release_escrow(ctx: Context<ReleaseEscrow>, params: ReleaseParams) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Validate release conditions
    require!(
        clock.unix_timestamp <= escrow.expiry_time || authority.key() == escrow.arbitrator,
        MarketplaceError::EscrowExpired
    );

    // Calculate amounts
    let release_amount = match params.release_type {
        ReleaseType::Full => escrow.amount,
        ReleaseType::Partial => params.partial_amount.unwrap_or(0),
        ReleaseType::Dispute => escrow.amount, // Handled by dispute resolution
    };

    require!(release_amount > 0, MarketplaceError::InvalidReleaseAmount);
    require!(release_amount <= escrow.amount, MarketplaceError::InsufficientEscrowBalance);

    let platform_fee = (release_amount * escrow.platform_fee_rate as u64) / 10000;
    let seller_amount = release_amount - platform_fee;

    // Create signer seeds
    let escrow_key = escrow.key();
    let seeds = &[b"escrow", escrow_key.as_ref(), &[escrow.bump]];
    let signer = &[&seeds[..]];

    // Transfer to seller
    if seller_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, seller_amount)?;
    }

    // Transfer platform fee
    if platform_fee > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.platform_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, platform_fee)?;
    }

    // Update escrow state
    escrow.amount -= release_amount;
    if escrow.amount == 0 {
        escrow.state = EscrowState::Completed;
        escrow.completed_at = Some(clock.unix_timestamp);
    }

    // Emit release event
    emit!(EscrowReleasedEvent {
        escrow: escrow.key(),
        released_amount: release_amount,
        seller_amount,
        platform_fee,
        release_type: params.release_type,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
