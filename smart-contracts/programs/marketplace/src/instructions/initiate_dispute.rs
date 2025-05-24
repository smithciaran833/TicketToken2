use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct InitiateDispute<'info> {
    #[account(mut)]
    pub disputer: Signer<'info>,

    #[account(
        init,
        payer = disputer,
        space = Dispute::LEN,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,

    #[account(
        mut,
        constraint = escrow.state == EscrowState::Active @ MarketplaceError::EscrowNotActive,
        constraint = disputer.key() == escrow.buyer || disputer.key() == escrow.seller @ MarketplaceError::UnauthorizedDisputer
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DisputeParams {
    pub category: DisputeCategory,
    pub description: String,
    pub evidence_links: Vec<String>,
    pub requested_resolution: ResolutionType,
}

pub fn initiate_dispute(ctx: Context<InitiateDispute>, params: DisputeParams) -> Result<()> {
    let dispute = &mut ctx.accounts.dispute;
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Validate dispute conditions
    require!(
        clock.unix_timestamp < escrow.expiry_time,
        MarketplaceError::EscrowExpired
    );

    require!(
        params.description.len() <= 1000,
        MarketplaceError::DescriptionTooLong
    );

    // Initialize dispute
    dispute.escrow = escrow.key();
    dispute.disputer = ctx.accounts.disputer.key();
    dispute.category = params.category;
    dispute.description = params.description;
    dispute.evidence_links = params.evidence_links;
    dispute.requested_resolution = params.requested_resolution;
    dispute.arbitrator = escrow.arbitrator;
    dispute.created_at = clock.unix_timestamp;
    dispute.deadline = clock.unix_timestamp + 7 * 24 * 60 * 60; // 7 days
    dispute.state = DisputeState::Open;
    dispute.bump = ctx.bumps.dispute;

    // Freeze escrow
    escrow.state = EscrowState::Disputed;
    escrow.disputed_at = Some(clock.unix_timestamp);

    // Emit dispute event
    emit!(DisputeInitiatedEvent {
        dispute: dispute.key(),
        escrow: escrow.key(),
        disputer: ctx.accounts.disputer.key(),
        category: params.category,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
