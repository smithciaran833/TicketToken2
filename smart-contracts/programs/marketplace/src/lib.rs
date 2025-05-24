// lib.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer, CloseAccount};
use anchor_spl::associated_token::AssociatedToken;

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;
use state::*;
use errors::*;

declare_id!("Marketplace1111111111111111111111111111111111111");

#[program]
pub mod ticket_marketplace {
    use super::*;

    /// Initialize marketplace with admin and fee settings
    pub fn initialize(
        ctx: Context<Initialize>,
        platform_fee_bps: u16,
        max_royalty_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, platform_fee_bps, max_royalty_bps)
    }

    /// Create a new listing for an NFT ticket
    pub fn create_listing(
        ctx: Context<CreateListing>,
        price: u64,
        listing_type: ListingType,
        auction_config: Option<AuctionConfig>,
        royalty_config: Option<RoyaltyConfig>,
    ) -> Result<()> {
        instructions::create_listing::handler(ctx, price, listing_type, auction_config, royalty_config)
    }

    /// Buy a ticket that has been listed on the marketplace at fixed price
    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        instructions::buy_ticket::handler(ctx)
    }

    /// Cancel an existing listing
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::cancel_listing::handler(ctx)
    }
    
    /// Create a bid on an auction listing
    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        instructions::place_bid::handler(ctx, amount)
    }
    
    /// End an auction and distribute proceeds
    pub fn end_auction(ctx: Context<EndAuction>) -> Result<()> {
        instructions::end_auction::handler(ctx)
    }

    /// Claim refund for outbid auction participants
    pub fn claim_bid_refund(ctx: Context<ClaimBidRefund>) -> Result<()> {
        instructions::claim_bid_refund::handler(ctx)
    }

    /// Create escrow for secure transactions
    pub fn create_escrow(ctx: Context<CreateEscrow>, terms: EscrowTerms) -> Result<()> {
        instructions::create_escrow::handler(ctx, terms)
    }

    /// Release escrow funds after conditions are met
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow::handler(ctx)
    }

    /// Initiate dispute for problematic transactions
    pub fn initiate_dispute(ctx: Context<InitiateDispute>, reason: String) -> Result<()> {
        instructions::initiate_dispute::handler(ctx, reason)
    }

    /// Resolve dispute (admin only)
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>, 
        resolution: DisputeResolution
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, resolution)
    }
    
    /// Update marketplace fee rate (admin only)
    pub fn update_marketplace_fee(ctx: Context<UpdateMarketplaceFee>, new_fee_bps: u16) -> Result<()> {
        instructions::update_marketplace_fee::handler(ctx, new_fee_bps)
    }

    /// Emergency pause marketplace (admin only)
    pub fn pause_marketplace(ctx: Context<PauseMarketplace>) -> Result<()> {
        instructions::pause_marketplace::handler(ctx)
    }

    /// Unpause marketplace (admin only)
    pub fn unpause_marketplace(ctx: Context<UnpauseMarketplace>) -> Result<()> {
        instructions::unpause_marketplace::handler(ctx)
    }

    /// Withdraw platform fees (admin only)
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        instructions::withdraw_fees::handler(ctx, amount)
    }
}

// ============================================================================
// state.rs - Data Structures
// ============================================================================

use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MarketplaceConfig {
    pub admin: Pubkey,
    pub platform_fee_bps: u16,          // Platform fee in basis points (100 = 1%)
    pub max_royalty_bps: u16,           // Maximum allowed royalty
    pub total_volume: u64,              // Total trading volume
    pub total_fees_collected: u64,      // Total platform fees collected
    pub is_paused: bool,                // Emergency pause state
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub price: u64,
    pub listing_type: ListingType,
    pub created_at: i64,
    pub auction_config: Option<AuctionConfig>,
    pub royalty_config: Option<RoyaltyConfig>,
    pub is_active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub bidder: Pubkey,
    pub listing: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub is_active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub terms: EscrowTerms,
    pub created_at: i64,
    pub release_at: i64,
    pub status: EscrowStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Dispute {
    pub plaintiff: Pubkey,
    pub defendant: Pubkey,
    pub escrow: Pubkey,
    #[max_len(200)]
    pub reason: String,
    pub created_at: i64,
    pub status: DisputeStatus,
    pub resolution: Option<DisputeResolution>,
    pub resolved_at: Option<i64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingType {
    FixedPrice,
    Auction,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub struct AuctionConfig {
    pub start_time: i64,
    pub end_time: i64,
    pub min_bid_increment: u64,
    pub reserve_price: Option<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub struct RoyaltyConfig {
    pub creator: Pubkey,
    pub percentage_bps: u16,  // Basis points (100 = 1%)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub struct EscrowTerms {
    pub release_condition: ReleaseCondition,
    pub timelock_duration: i64,  // Seconds until automatic release
    pub dispute_period: i64,     // Time allowed for disputes
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus {
    Active,
    Released,
    Disputed,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ReleaseCondition {
    TimeElapsed,
    BuyerConfirmation,
    SellerConfirmation,
    BothPartiesConfirmation,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DisputeStatus {
    Open,
    UnderReview,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DisputeResolution {
    RefundBuyer,
    PaySeller,
    Split,
}

// ============================================================================
// errors.rs - Error Types
// ============================================================================

use anchor_lang::prelude::*;

#[error_code]
pub enum MarketplaceError {
    #[msg("Marketplace is currently paused")]
    MarketplacePaused,
    
    #[msg("Invalid fee percentage (max 10%)")]
    InvalidFeePercentage,
    
    #[msg("Invalid royalty percentage")]
    InvalidRoyaltyPercentage,
    
    #[msg("Listing not found or inactive")]
    ListingNotActive,
    
    #[msg("Unauthorized seller")]
    UnauthorizedSeller,
    
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Auction not started yet")]
    AuctionNotStarted,
    
    #[msg("Auction has ended")]
    AuctionEnded,
    
    #[msg("Auction still active")]
    AuctionStillActive,
    
    #[msg("Bid too low")]
    BidTooLow,
    
    #[msg("Cannot bid on own listing")]
    CannotBidOnOwnListing,
    
    #[msg("No bids placed")]
    NoBidsPlaced,
    
    #[msg("Reserve price not met")]
    ReservePriceNotMet,
    
    #[msg("Not auction listing")]
    NotAuctionListing,
    
    #[msg("Not fixed price listing")]
    NotFixedPriceListing,
    
    #[msg("Escrow not ready for release")]
    EscrowNotReady,
    
    #[msg("Dispute period expired")]
    DisputePeriodExpired,
    
    #[msg("Dispute already exists")]
    DisputeAlreadyExists,
    
    #[msg("Invalid dispute resolution")]
    InvalidDisputeResolution,
    
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    
    #[msg("Invalid timelock duration")]
    InvalidTimelockDuration,
    
    #[msg("Math overflow")]
    MathOverflow,
}

// ============================================================================
// instructions/mod.rs - Instruction Modules
// ============================================================================

pub mod initialize;
pub mod create_listing;
pub mod buy_ticket;
pub mod cancel_listing;
pub mod place_bid;
pub mod end_auction;
pub mod claim_bid_refund;
pub mod create_escrow;
pub mod release_escrow;
pub mod initiate_dispute;
pub mod resolve_dispute;
pub mod update_marketplace_fee;
pub mod pause_marketplace;
pub mod unpause_marketplace;
pub mod withdraw_fees;

// Context structs for all instructions
use crate::state::*;
use crate::errors::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + MarketplaceConfig::INIT_SPACE,
        seeds = [b"marketplace_config"],
        bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", mint.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    
    #[account(
        mut,
        constraint = seller_token_account.mint == mint.key(),
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.amount == 1
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub seller: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        constraint = listing.is_active,
        constraint = listing.listing_type == ListingType::FixedPrice
    )]
    pub listing: Account<'info, Listing>,
    
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    #[account(mut)]
    /// CHECK: Seller account for payment
    pub seller: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Platform fee recipient
    pub fee_recipient: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Royalty recipient (optional)
    pub royalty_recipient: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        has_one = seller,
        constraint = listing.is_active
    )]
    pub listing: Account<'info, Listing>,
    
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub seller: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        constraint = listing.is_active,
        constraint = listing.listing_type == ListingType::Auction
    )]
    pub listing: Account<'info, Listing>,
    
    #[account(
        init,
        payer = bidder,
        space = 8 + Bid::INIT_SPACE,
        seeds = [b"bid", listing.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: Account<'info, Bid>,
    
    #[account(
        init,
        payer = bidder,
        seeds = [b"bid_escrow", bid.key().as_ref()],
        bump,
        space = 0
    )]
    /// CHECK: PDA for holding bid funds
    pub bid_escrow: UncheckedAccount<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub bidder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndAuction<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        constraint = listing.is_active,
        constraint = listing.listing_type == ListingType::Auction
    )]
    pub listing: Account<'info, Listing>,
    
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = winner,
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"bid", listing.key().as_ref(), winner.key().as_ref()],
        bump = winning_bid.bump
    )]
    pub winning_bid: Account<'info, Bid>,
    
    #[account(
        mut,
        seeds = [b"bid_escrow", winning_bid.key().as_ref()],
        bump
    )]
    /// CHECK: PDA holding winning bid funds
    pub bid_escrow: UncheckedAccount<'info>,
    
    pub mint: Account<'info, Mint>,
    
    /// CHECK: Winner of the auction
    pub winner: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Seller receiving payment
    pub seller: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Platform fee recipient
    pub fee_recipient: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Royalty recipient (optional)
    pub royalty_recipient: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub caller: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimBidRefund<'info> {
    #[account(
        mut,
        seeds = [b"bid", listing.key().as_ref(), bidder.key().as_ref()],
        bump = bid.bump,
        has_one = bidder,
        constraint = !bid.is_active
    )]
    pub bid: Account<'info, Bid>,
    
    #[account(
        mut,
        seeds = [b"bid_escrow", bid.key().as_ref()],
        bump
    )]
    /// CHECK: PDA holding bid funds
    pub bid_escrow: UncheckedAccount<'info>,
    
    /// CHECK: Listing for validation
    pub listing: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub bidder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", mint.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// CHECK: Seller for escrow
    pub seller: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", mint.key().as_ref(), buyer.key().as_ref()],
        bump = escrow.bump,
        constraint = escrow.status == EscrowStatus::Active
    )]
    pub escrow: Account<'info, Escrow>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    /// CHECK: Buyer account
    pub buyer: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: UncheckedAccount<'info>,
    
    pub signer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitiateDispute<'info> {
    #[account(
        mut,
        seeds = [b"escrow", mint.key().as_ref(), buyer.key().as_ref()],
        bump = escrow.bump,
        constraint = escrow.status == EscrowStatus::Active
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(
        init,
        payer = plaintiff,
        space = 8 + Dispute::INIT_SPACE,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,
    
    pub mint: Account<'info, Mint>,
    
    /// CHECK: Buyer account
    pub buyer: UncheckedAccount<'info>,
    
    /// CHECK: Seller account
    pub seller: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub plaintiff: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        has_one = admin
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        mut,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump = dispute.bump,
        constraint = dispute.status == DisputeStatus::Open || dispute.status == DisputeStatus::UnderReview
    )]
    pub dispute: Account<'info, Dispute>,
    
    #[account(
        mut,
        constraint = escrow.status == EscrowStatus::Disputed
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(mut)]
    /// CHECK: Buyer account
    pub buyer: UncheckedAccount<'info>,
    
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: UncheckedAccount<'info>,
    
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketplaceFee<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        has_one = admin
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct PauseMarketplace<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        has_one = admin
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnpauseMarketplace<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        has_one = admin
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        has_one = admin
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    #[account(
        mut,
        seeds = [b"fee_vault"],
        bump
    )]
    /// CHECK: Platform fee vault
    pub fee_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events for tracking marketplace activities
// ============================================================================

#[event]
pub struct ListingCreated {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub price: u64,
    pub listing_type: ListingType,
}

#[event]
pub struct ItemSold {
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub price: u64,
    pub platform_fee: u64,
    pub royalty_fee: u64,
}

#[event]
pub struct BidPlaced {
    pub listing: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AuctionEnded {
    pub listing: Pubkey,
    pub winner: Pubkey,
    pub winning_bid: u64,
}

#[event]
pub struct DisputeInitiated {
    pub dispute: Pubkey,
    pub escrow: Pubkey,
    pub plaintiff: Pubkey,
    pub defendant: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub dispute: Pubkey,
    pub resolution: DisputeResolution,
    pub resolved_by: Pubkey,
}
