// File: contracts/programs/marketplace/src/instructions/claim_bid_refund.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
#[instruction(bid_bump: u8)]
pub struct ClaimBidRefund<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bid", auction.key().as_ref(), bidder.key().as_ref()],
        bump = bid_bump,
        constraint = bid.bidder == bidder.key() @ MarketplaceError::UnauthorizedBidder,
        constraint = bid.state == BidState::Unsuccessful || bid.state == BidState::Cancelled @ MarketplaceError::BidNotRefundable
    )]
    pub bid: Account<'info, Bid>,

    #[account(
        constraint = auction.state == AuctionState::Ended || auction.state == AuctionState::Cancelled @ MarketplaceError::AuctionStillActive
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [b"escrow", auction.key().as_ref()],
        bump,
        constraint = escrow.auction == auction.key() @ MarketplaceError::InvalidEscrow
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow.key() @ MarketplaceError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = bidder_token_account.owner == bidder.key() @ MarketplaceError::InvalidBidderTokenAccount
    )]
    pub bidder_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn claim_bid_refund(ctx: Context<ClaimBidRefund>) -> Result<()> {
    let bid = &mut ctx.accounts.bid;
    let escrow = &ctx.accounts.escrow;
    let auction = &ctx.accounts.auction;

    // Validate refund conditions
    require!(
        bid.state != BidState::Refunded,
        MarketplaceError::BidAlreadyRefunded
    );

    require!(
        Clock::get()?.unix_timestamp > auction.end_time,
        MarketplaceError::AuctionNotEnded
    );

    // Calculate refund amount
    let refund_amount = bid.amount;
    
    // Validate escrow has sufficient balance
    require!(
        ctx.accounts.escrow_token_account.amount >= refund_amount,
        MarketplaceError::InsufficientEscrowBalance
    );

    // Transfer tokens back to bidder
    let auction_key = auction.key();
    let seeds = &[b"escrow", auction_key.as_ref(), &[escrow.bump]];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        to: ctx.accounts.bidder_token_account.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, refund_amount)?;

    // Update bid state
    bid.state = BidState::Refunded;
    bid.refunded_at = Clock::get()?.unix_timestamp;

    // Emit refund event
    emit!(BidRefundEvent {
        auction: auction.key(),
        bidder: ctx.accounts.bidder.key(),
        amount: refund_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// File: contracts/programs/marketplace/src/instructions/create_escrow.rs
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

// File: contracts/programs/marketplace/src/instructions/initiate_dispute.rs
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

// File: contracts/programs/marketplace/src/instructions/resolve_dispute.rs
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

// File: contracts/programs/marketplace/src/instructions/pause_marketplace.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct PauseMarketplace<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = marketplace.admin == admin.key() @ MarketplaceError::UnauthorizedAdmin,
        constraint = !marketplace.is_paused @ MarketplaceError::AlreadyPaused
    )]
    pub marketplace: Account<'info, Marketplace>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PauseParams {
    pub pause_level: PauseLevel,
    pub reason: String,
    pub duration: Option<i64>,
    pub affected_features: Vec<Feature>,
}

pub fn pause_marketplace(ctx: Context<PauseMarketplace>, params: PauseParams) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;

    // Validate pause parameters
    require!(params.reason.len() <= 500, MarketplaceError::ReasonTooLong);

    // Update marketplace state
    marketplace.is_paused = true;
    marketplace.pause_level = params.pause_level;
    marketplace.pause_reason = Some(params.reason.clone());
    marketplace.paused_at = Some(clock.unix_timestamp);
    marketplace.pause_duration = params.duration;
    marketplace.affected_features = params.affected_features.clone();

    // Set automatic unpause if duration specified
    if let Some(duration) = params.duration {
        marketplace.auto_unpause_at = Some(clock.unix_timestamp + duration);
    }

    // Emit pause event
    emit!(MarketplacePausedEvent {
        marketplace: marketplace.key(),
        admin: ctx.accounts.admin.key(),
        pause_level: params.pause_level,
        reason: params.reason,
        duration: params.duration,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// File: contracts/programs/marketplace/src/instructions/unpause_marketplace.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct UnpauseMarketplace<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = marketplace.admin == admin.key() @ MarketplaceError::UnauthorizedAdmin,
        constraint = marketplace.is_paused @ MarketplaceError::NotPaused
    )]
    pub marketplace: Account<'info, Marketplace>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UnpauseParams {
    pub gradual_rollout: bool,
    pub features_to_enable: Vec<Feature>,
}

pub fn unpause_marketplace(ctx: Context<UnpauseMarketplace>, params: UnpauseParams) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;

    // Perform safety checks before unpause
    require!(
        marketplace.system_health_check(),
        MarketplaceError::SystemHealthCheckFailed
    );

    if params.gradual_rollout {
        // Gradual unpause - enable specific features
        marketplace.pause_level = PauseLevel::Partial;
        marketplace.affected_features = marketplace.affected_features
            .iter()
            .filter(|f| !params.features_to_enable.contains(f))
            .cloned()
            .collect();
            
        if marketplace.affected_features.is_empty() {
            marketplace.is_paused = false;
            marketplace.pause_level = PauseLevel::None;
        }
    } else {
        // Full unpause
        marketplace.is_paused = false;
        marketplace.pause_level = PauseLevel::None;
        marketplace.affected_features.clear();
    }

    // Clear pause-related fields if fully unpaused
    if !marketplace.is_paused {
        marketplace.pause_reason = None;
        marketplace.paused_at = None;
        marketplace.pause_duration = None;
        marketplace.auto_unpause_at = None;
        marketplace.unpaused_at = Some(clock.unix_timestamp);
    }

    // Emit unpause event
    emit!(MarketplaceUnpausedEvent {
        marketplace: marketplace.key(),
        admin: ctx.accounts.admin.key(),
        gradual_rollout: params.gradual_rollout,
        enabled_features: params.features_to_enable,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// File: contracts/programs/marketplace/src/instructions/withdraw_fees.rs
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

// File: contracts/programs/marketplace/src/instructions/utils.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::MarketplaceError;

// PDA derivation utilities
pub fn derive_bid_pda(auction: &Pubkey, bidder: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"bid", auction.as_ref(), bidder.as_ref()],
        &crate::ID
    )
}

pub fn derive_escrow_pda(transaction_id: &str) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"escrow", transaction_id.as_bytes()],
        &crate::ID
    )
}

pub fn derive_dispute_pda(escrow: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"dispute", escrow.as_ref()],
        &crate::ID
    )
}

pub fn derive_fee_vault_pda(marketplace: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"fee_vault", marketplace.as_ref()],
        &crate::ID
    )
}

pub fn derive_auction_pda(creator: &Pubkey, nft_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"auction", creator.as_ref(), nft_mint.as_ref()],
        &crate::ID
    )
}

// Token transfer utilities with comprehensive error handling
pub fn transfer_tokens_with_signer<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require!(amount > 0, MarketplaceError::InvalidAmount);
    require!(from.amount >= amount, MarketplaceError::InsufficientBalance);

    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        cpi_accounts,
        signer_seeds
    );
    
    token::transfer(cpi_ctx, amount)
}

pub fn transfer_tokens<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, MarketplaceError::InvalidAmount);
    require!(from.amount >= amount, MarketplaceError::InsufficientBalance);

    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)
}

// Fee calculation utilities with configurable rates
pub fn calculate_platform_fee(amount: u64, fee_rate: u16) -> Result<u64> {
    require!(fee_rate <= 10000, MarketplaceError::InvalidFeeRate); // Max 100%
    Ok((amount as u128 * fee_rate as u128 / 10000) as u64)
}

pub fn calculate_royalty_fee(amount: u64, royalty_rate: u16) -> Result<u64> {
    require!(royalty_rate <= 5000, MarketplaceError::InvalidRoyaltyRate); // Max 50%
    Ok((amount as u128 * royalty_rate as u128 / 10000) as u64)
}

pub fn calculate_bid_increment(current_bid: u64, increment_rate: u16) -> Result<u64> {
    require!(increment_rate > 0, MarketplaceError::InvalidIncrementRate);
    let increment = (current_bid as u128 * increment_rate as u128 / 10000) as u64;
    Ok(increment.max(1)) // Minimum increment of 1
}

pub fn calculate_total_fees(
    amount: u64,
    platform_fee_rate: u16,
    royalty_rate: u16,
) -> Result<(u64, u64, u64)> {
    let platform_fee = calculate_platform_fee(amount, platform_fee_rate)?;
    let royalty_fee = calculate_royalty_fee(amount, royalty_rate)?;
    let net_amount = amount.checked_sub(platform_fee + royalty_fee)
        .ok_or(MarketplaceError::ArithmeticOverflow)?;
    
    Ok((net_amount, platform_fee, royalty_fee))
}

// Time validation functions for auctions and disputes
pub fn validate_auction_timing(
    start_time: i64,
    end_time: i64,
    current_time: i64,
) -> Result<()> {
    require!(start_time > current_time, MarketplaceError::InvalidStartTime);
    require!(end_time > start_time, MarketplaceError::InvalidEndTime);
    require!(
        end_time - start_time >= 3600, // Minimum 1 hour duration
        MarketplaceError::AuctionTooShort
    );
    require!(
        end_time - start_time <= 30 * 24 * 3600, // Maximum 30 days
        MarketplaceError::AuctionTooLong
    );
    Ok(())
}

pub fn validate_escrow_timing(expiry_time: i64, current_time: i64) -> Result<()> {
    require!(expiry_time > current_time, MarketplaceError::InvalidExpiryTime);
    require!(
        expiry_time - current_time >= 24 * 3600, // Minimum 24 hours
        MarketplaceError::EscrowTooShort
    );
    require!(
        expiry_time - current_time <= 90 * 24 * 3600, // Maximum 90 days
        MarketplaceError::EscrowTooLong
    );
    Ok(())
}

pub fn is_auction_active(auction: &Auction, current_time: i64) -> bool {
    current_time >= auction.start_time && 
    current_time <= auction.end_time && 
    auction.state == AuctionState::Active
}

pub fn is_bid_period_ended(auction: &Auction, current_time: i64) -> bool {
    current_time > auction.end_time
}

// Access control helper functions
pub fn validate_admin_access(admin: &Pubkey, marketplace: &Marketplace) -> Result<()> {
    require!(
        *admin == marketplace.admin,
        MarketplaceError::UnauthorizedAdmin
    );
    Ok(())
}

pub fn validate_auction_authority(
    authority: &Pubkey,
    auction: &Auction,
) -> Result<()> {
    require!(
        *authority == auction.creator,
        MarketplaceError::UnauthorizedAuctionAuthority
    );
    Ok(())
}

pub fn validate_escrow_participant(
    participant: &Pubkey,
    escrow: &Escrow,
) -> Result<()> {
    require!(
        *participant == escrow.buyer || 
        *participant == escrow.seller || 
        *participant == escrow.arbitrator,
        MarketplaceError::UnauthorizedEscrowParticipant
    );
    Ok(())
}

pub fn validate_marketplace_not_paused(
    marketplace: &Marketplace,
    feature: Feature,
) -> Result<()> {
    if marketplace.is_paused {
        match marketplace.pause_level {
            PauseLevel::Full => return Err(MarketplaceError::MarketplacePaused.into()),
            PauseLevel::Partial => {
                if marketplace.affected_features.contains(&feature) {
                    return Err(MarketplaceError::FeaturePaused.into());
                }
            }
            PauseLevel::None => {} // Should not be paused with None level
        }
    }
    Ok(())
}

// Account validation and constraint checking functions
pub fn validate_token_account_owner(
    token_account: &TokenAccount,
    expected_owner: &Pubkey,
) -> Result<()> {
    require!(
        token_account.owner == *expected_owner,
        MarketplaceError::InvalidTokenAccountOwner
    );
    Ok(())
}

pub fn validate_token_account_mint(
    token_account: &TokenAccount,
    expected_mint: &Pubkey,
) -> Result<()> {
    require!(
        token_account.mint == *expected_mint,
        MarketplaceError::InvalidTokenMint
    );
    Ok(())
}

pub fn validate_account_rent_exemption(
    account_info: &AccountInfo,
    rent: &Sysvar<Rent>,
) -> Result<()> {
    let account_lamports = account_info.lamports();
    let required_lamports = rent.minimum_balance(account_info.data_len());
    
    require!(
        account_lamports >= required_lamports,
        MarketplaceError::InsufficientRentExemption
    );
    Ok(())
}

// Math utilities for bid increments and percentages
pub fn safe_add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(MarketplaceError::ArithmeticOverflow.into())
}

pub fn safe_sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(MarketplaceError::ArithmeticUnderflow.into())
}

pub fn safe_mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or(MarketplaceError::ArithmeticOverflow.into())
}

pub fn safe_div(a: u64, b: u64) -> Result<u64> {
    require!(b > 0, MarketplaceError::DivisionByZero);
    Ok(a / b)
}

pub fn calculate_percentage(amount: u64, percentage: u16) -> Result<u64> {
    require!(percentage <= 10000, MarketplaceError::InvalidPercentage); // Max 100%
    Ok((amount as u128 * percentage as u128 / 10000) as u64)
}

pub fn calculate_minimum_bid(
    current_highest_bid: u64,
    minimum_increment: u64,
    reserve_price: Option<u64>,
) -> Result<u64> {
    let base_minimum = if current_highest_bid == 0 {
        reserve_price.unwrap_or(1)
    } else {
        safe_add(current_highest_bid, minimum_increment)?
    };
    
    if let Some(reserve) = reserve_price {
        Ok(base_minimum.max(reserve))
    } else {
        Ok(base_minimum)
    }
}

// Event emission utilities with standardized formats
pub fn emit_auction_event<T: Event>(event: T) {
    emit!(event);
}

pub fn emit_bid_event<T: Event>(event: T) {
    emit!(event);
}

pub fn emit_escrow_event<T: Event>(event: T) {
    emit!(event);
}

pub fn emit_dispute_event<T: Event>(event: T) {
    emit!(event);
}

pub fn emit_marketplace_event<T: Event>(event: T) {
    emit!(event);
}

// Error conversion and handling utilities
pub fn map_anchor_error(error: anchor_lang::error::Error) -> MarketplaceError {
    match error {
        anchor_lang::error::Error::AccountNotEnoughKeys => MarketplaceError::InsufficientAccounts,
        anchor_lang::error::Error::AccountNotMutable => MarketplaceError::AccountNotMutable,
        anchor_lang::error::Error::AccountOwnedByWrongProgram => MarketplaceError::AccountOwnedByWrongProgram,
        anchor_lang::error::Error::InvalidProgramId => MarketplaceError::InvalidProgramId,
        anchor_lang::error::Error::InvalidAccountData => MarketplaceError::InvalidAccountData,
        _ => MarketplaceError::UnknownError,
    }
}

pub fn handle_cpi_error(error: ProgramError) -> MarketplaceError {
    match error {
        ProgramError::InsufficientFunds => MarketplaceError::InsufficientFunds,
        ProgramError::InvalidAccountData => MarketplaceError::InvalidAccountData,
        ProgramError::InvalidArgument => MarketplaceError::InvalidArgument,
        ProgramError::AccountNotRentExempt => MarketplaceError::InsufficientRentExemption,
        _ => MarketplaceError::CpiError,
    }
}

// Logging and debugging utilities for development
#[cfg(feature = "debug")]
pub fn log_instruction_start(instruction_name: &str) {
    msg!("Starting instruction: {}", instruction_name);
}

#[cfg(feature = "debug")]
pub fn log_instruction_end(instruction_name: &str) {
    msg!("Completed instruction: {}", instruction_name);
}

#[cfg(feature = "debug")]
pub fn log_account_state<T: std::fmt::Debug>(account_name: &str, state: &T) {
    msg!("Account {} state: {:?}", account_name, state);
}

#[cfg(feature = "debug")]
pub fn log_calculation(description: &str, result: u64) {
    msg!("Calculation {}: {}", description, result);
}

// Performance optimization helpers for gas efficiency
pub fn batch_validate_accounts(validations: Vec<Box<dyn Fn() -> Result<()>>>) -> Result<()> {
    for validation in validations {
        validation()?;
    }
    Ok(())
}

pub fn optimize_token_transfers<'info>(
    transfers: Vec<TokenTransfer<'info>>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    // Group transfers by authority to minimize CPI calls
    for transfer in transfers {
        match transfer.signer_seeds {
            Some(seeds) => {
                transfer_tokens_with_signer(
                    &transfer.from,
                    &transfer.to,
                    &transfer.authority,
                    token_program,
                    transfer.amount,
                    &[seeds],
                )?;
            }
            None => {
                // This would require the authority to be a Signer, but we have AccountInfo
                // In practice, you'd need to handle this differently based on your specific needs
                return Err(MarketplaceError::InvalidTransferAuthority.into());
            }
        }
    }
    Ok(())
}

// Helper struct for batch token transfers
pub struct TokenTransfer<'info> {
    pub from: Account<'info, TokenAccount>,
    pub to: Account<'info, TokenAccount>,
    pub authority: AccountInfo<'info>,
    pub amount: u64,
    pub signer_seeds: Option<&'info [&'info [u8]]>,
}

// Validation helper for common constraints
pub fn validate_common_constraints(
    amount: u64,
    current_time: i64,
    marketplace: &Marketplace,
    feature: Feature,
) -> Result<()> {
    require!(amount > 0, MarketplaceError::InvalidAmount);
    validate_marketplace_not_paused(marketplace, feature)?;
    Ok(())
}

// Helper for consistent timestamp handling
pub fn get_current_timestamp() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

// Helper for consistent slot handling
pub fn get_current_slot() -> Result<u64> {
    Ok(Clock::get()?.slot)
}

// Helper for epoch handling
pub fn get_current_epoch() -> Result<u64> {
    Ok(Clock::get()?.epoch)
}

// File: contracts/programs/marketplace/src/errors.rs (Updated)
use anchor_lang::prelude::*;

#[error_code]
pub enum MarketplaceError {
    // Bid-related errors (6000-6099)
    #[msg("Unauthorized bidder")]
    UnauthorizedBidder = 6000,
    #[msg("Bid is not refundable")]
    BidNotRefundable = 6001,
    #[msg("Bid already refunded")]
    BidAlreadyRefunded = 6002,
    #[msg("Auction is still active")]
    AuctionStillActive = 6003,
    #[msg("Auction has not ended")]
    AuctionNotEnded = 6004,
    #[msg("Invalid bid amount")]
    InvalidBidAmount = 6005,
    #[msg("Bid too low")]
    BidTooLow = 6006,
    #[msg("Self bidding not allowed")]
    SelfBiddingNotAllowed = 6007,

    // Escrow-related errors (6100-6199)
    #[msg("Invalid escrow")]
    InvalidEscrow = 6100,
    #[msg("Invalid escrow token account")]
    InvalidEscrowTokenAccount = 6101,
    #[msg("Invalid bidder token account")]
    InvalidBidderTokenAccount = 6102,
    #[msg("Insufficient escrow balance")]
    InsufficientEscrowBalance = 6103,
    #[msg("Escrow not active")]
    EscrowNotActive = 6104,
    #[msg("Unauthorized release")]
    UnauthorizedRelease = 6105,
    #[msg("Escrow expired")]
    EscrowExpired = 6106,
    #[msg("Invalid release amount")]
    InvalidReleaseAmount = 6107,
    #[msg("Escrow not disputed")]
    EscrowNotDisputed = 6108,
    #[msg("Invalid creator token account")]
    InvalidCreatorTokenAccount = 6109,
    #[msg("Invalid seller token account")]
    InvalidSellerTokenAccount = 6110,
    #[msg("Escrow too short")]
    EscrowTooShort = 6111,
    #[msg("Escrow too long")]
    EscrowTooLong = 6112,

    // Dispute-related errors (6200-6299)
    #[msg("Unauthorized disputer")]
    UnauthorizedDisputer = 6200,
    #[msg("Description too long")]
    DescriptionTooLong = 6201,
    #[msg("Dispute not open")]
    DisputeNotOpen = 6202,
    #[msg("Unauthorized arbitrator")]
    UnauthorizedArbitrator = 6203,
    #[msg("Invalid resolution amounts")]
    InvalidResolutionAmounts = 6204,
    #[msg("Dispute deadline passed")]
    DisputeDeadlinePassed = 6205,
    #[msg("Invalid dispute category")]
    InvalidDisputeCategory = 6206,

    // Marketplace management errors (6300-6399)
    #[msg("Unauthorized admin")]
    UnauthorizedAdmin = 6300,
    #[msg("Already paused")]
    AlreadyPaused = 6301,
    #[msg("Not paused")]
    NotPaused = 6302,
    #[msg("Reason too long")]
    ReasonTooLong = 6303,
    #[msg("Marketplace paused")]
    MarketplacePaused = 6304,
    #[msg("Feature paused")]
    FeaturePaused = 6305,
    #[msg("System health check failed")]
    SystemHealthCheckFailed = 6306,

    // Fee management errors (6400-6499)
    #[msg("No fees to withdraw")]
    NoFeesToWithdraw = 6400,
    #[msg("Invalid vault token account")]
    InvalidVaultTokenAccount = 6401,
    #[msg("Invalid treasury token account")]
    InvalidTreasuryTokenAccount = 6402,
    #[msg("Insufficient fees")]
    InsufficientFees = 6403,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance = 6404,
    #[msg("Invalid platform token account")]
    InvalidPlatformTokenAccount = 6405,

    // General validation errors (6500-6599)
    #[msg("Invalid amount")]
    InvalidAmount = 6500,
    #[msg("Invalid expiry time")]
    InvalidExpiryTime = 6501,
    #[msg("Invalid fee rate")]
    InvalidFeeRate = 6502,
    #[msg("Invalid start time")]
    InvalidStartTime = 6503,
    #[msg("Invalid end time")]
    InvalidEndTime = 6504,
    #[msg("Auction too short")]
    AuctionTooShort = 6505,
    #[msg("Auction too long")]
    AuctionTooLong = 6506,
    #[msg("Invalid royalty rate")]
    InvalidRoyaltyRate = 6507,
    #[msg("Invalid increment rate")]
    InvalidIncrementRate = 6508,
    #[msg("Invalid percentage")]
    InvalidPercentage = 6509,

    // Account validation errors (6600-6699)
    #[msg("Invalid token account owner")]
    InvalidTokenAccountOwner = 6600,
    #[msg("Invalid token mint")]
    InvalidTokenMint = 6601,
    #[msg("Insufficient rent exemption")]
    InsufficientRentExemption = 6602,
    #[msg("Account not mutable")]
    AccountNotMutable = 6603,
    #[msg("Account owned by wrong program")]
    AccountOwnedByWrongProgram = 6604,
    #[msg("Invalid program id")]
    InvalidProgramId = 6605,
    #[msg("Invalid account data")]
    InvalidAccountData = 6606,
    #[msg("Insufficient accounts")]
    InsufficientAccounts = 6607,

    // Authorization errors (6700-6799)
    #[msg("Unauthorized auction authority")]
    UnauthorizedAuctionAuthority = 6700,
    #[msg("Unauthorized escrow participant")]
    UnauthorizedEscrowParticipant = 6701,
    #[msg("Invalid transfer authority")]
    InvalidTransferAuthority = 6702,

    // Math and arithmetic errors (6800-6899)
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow = 6800,
    #[msg("Arithmetic underflow")]
    ArithmeticUnderflow = 6801,
    #[msg("Division by zero")]
    DivisionByZero = 6802,

    // System errors (6900-6999)
    #[msg("Insufficient balance")]
    InsufficientBalance = 6900,
    #[msg("Insufficient funds")]
    InsufficientFunds = 6901,
    #[msg("Invalid argument")]
    InvalidArgument = 6902,
    #[msg("CPI error")]
    CpiError = 6903,
    #[msg("Unknown error")]
    UnknownError = 6904,
}
