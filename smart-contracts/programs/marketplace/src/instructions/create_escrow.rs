use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Escrow::LEN,
        seeds = [b"escrow", transaction_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: Validated in instruction
    pub seller: AccountInfo<'info>,

    /// CHECK: Validated in instruction  
    pub arbitrator: AccountInfo<'info>,

    #[account(
        mut,
        constraint = creator_token_account.owner == creator.key() @ MarketplaceError::InvalidCreatorTokenAccount
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow.key() @ MarketplaceError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateEscrowParams {
    pub transaction_id: String,
    pub amount: u64,
    pub expiry_time: i64,
    pub terms: String,
    pub dispute_period: i64,
    pub platform_fee_rate: u16,
}

pub fn create_escrow(ctx: Context<CreateEscrow>, params: CreateEscrowParams) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Validate inputs
    require!(params.amount > 0, MarketplaceError::InvalidAmount);
    require!(params.expiry_time > clock.unix_timestamp, MarketplaceError::InvalidExpiryTime);
    require!(params.platform_fee_rate <= 1000, MarketplaceError::InvalidFeeRate); // Max 10%

    // Initialize escrow
    escrow.buyer = ctx.accounts.creator.key();
    escrow.seller = ctx.accounts.seller.key();
    escrow.arbitrator = ctx.accounts.arbitrator.key();
    escrow.amount = params.amount;
    escrow.created_at = clock.unix_timestamp;
    escrow.expiry_time = params.expiry_time;
    escrow.terms = params.terms;
    escrow.dispute_period = params.dispute_period;
    escrow.platform_fee_rate = params.platform_fee_rate;
    escrow.state = EscrowState::Active;
    escrow.bump = ctx.bumps.escrow;

    // Transfer tokens to escrow
    let cpi_accounts = Transfer {
        from: ctx.accounts.creator_token_account.to_account_info(),
        to: ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, params.amount)?;

    // Emit creation event
    emit!(EscrowCreatedEvent {
        escrow: escrow.key(),
        buyer: escrow.buyer,
        seller: escrow.seller,
        amount: params.amount,
        expiry_time: params.expiry_time,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
