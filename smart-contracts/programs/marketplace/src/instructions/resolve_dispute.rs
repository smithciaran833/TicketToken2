use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub arbitrator: Signer<'info>,

    #[account(
        mut,
        constraint = dispute.state == DisputeState::Open @ MarketplaceError::DisputeNotOpen,
        constraint = arbitrator.key() == dispute.arbitrator @ MarketplaceError::UnauthorizedArbitrator
    )]
    pub dispute: Account<'info, Dispute>,

    #[account(
        mut,
        constraint = escrow.state == EscrowState::Disputed @ MarketplaceError::EscrowNotDisputed
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow.key() @ MarketplaceError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub platform_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ResolutionParams {
    pub decision: ResolutionDecision,
    pub reasoning: String,
    pub buyer_amount: u64,
    pub seller_amount: u64,
}

pub fn resolve_dispute(ctx: Context<ResolveDispute>, params: ResolutionParams) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Validate resolution
    require!(
        params.buyer_amount + params.seller_amount <= escrow.amount,
        MarketplaceError::InvalidResolutionAmounts
    );

    // Calculate platform fee
    let total_distributed = params.buyer_amount + params.seller_amount;
    let platform_fee = escrow.amount - total_distributed;

    // Create signer seeds
    let escrow_key = escrow.key();
    let seeds = &[b"escrow", escrow_key.as_ref(), &[escrow.bump]];
    let signer = &[&seeds[..]];

    // Distribute funds based on resolution
    if params.buyer_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, params.buyer_amount)?;
    }

    if params.seller_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, params.seller_amount)?;
    }

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

    // Update dispute state
    dispute.state = DisputeState::Resolved;
    dispute.decision = Some(params.decision);
    dispute.reasoning = Some(params.reasoning);
    dispute.resolved_at = Some(clock.unix_timestamp);

    // Update escrow state
    escrow.state = EscrowState::Completed;
    escrow.completed_at = Some(clock.unix_timestamp);

    // Emit resolution event
    emit!(DisputeResolvedEvent {
        dispute: dispute.key(),
        escrow: escrow.key(),
        decision: params.decision,
        buyer_amount: params.buyer_amount,
        seller_amount: params.seller_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
