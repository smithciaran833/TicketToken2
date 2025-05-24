// File: contracts/programs/ticket-minter/src/instructions/marketplace.rs
//
// This file should be placed in the contracts/programs/ticket-minter/src/instructions directory
// along with other instruction modules for the TicketToken Solana program.
//
// This implements Day 5 deliverables:
// - Marketplace contracts
// - Royalty distribution logic
// - Auction functionality

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::program::invoke_signed;
use solana_program::system_instruction;

use crate::{Ticket, TicketStatus, TicketError, Event, TransferRecord, TransferType};

/// Status of a marketplace listing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ListingStatus {
    // Standard fixed-price listing
    Active,
    // Listing has sold
    Sold,
    // Listing was canceled
    Canceled,
    // Auction is active
    AuctionActive,
    // Auction has ended with bids
    AuctionEnded,
    // Auction ended with no bids
    AuctionExpired,
}

/// Type of marketplace listing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ListingType {
    // Fixed price listing
    FixedPrice,
    // Standard timed auction
    Auction,
    // Dutch auction (price decreases over time)
    DutchAuction,
}

/// Marketplace listing account
#[account]
pub struct MarketplaceListing {
    // Unique identifier for the listing
    pub listing_id: String,
    // The ticket being sold
    pub ticket: Pubkey,
    // The mint of the ticket NFT
    pub mint: Pubkey,
    // The owner/seller of the ticket
    pub owner: Pubkey,
    // Reference to the event
    pub event: Pubkey,
    // Type of listing
    pub listing_type: ListingType,
    // Status of the listing
    pub status: ListingStatus,
    // Price for fixed listings or starting price for auctions
    pub price: u64,
    // For Dutch auctions, the ending price
    pub ending_price: Option<u64>,
    // For auctions, the minimum bid increment
    pub min_bid_increment: Option<u64>,
    // Creation timestamp
    pub created_at: i64,
    // Expiration timestamp
    pub expiry: Option<i64>,
    // For auctions, current highest bid
    pub highest_bid: Option<u64>,
    // For auctions, current highest bidder
    pub highest_bidder: Option<Pubkey>,
    // Whether the listing allows direct offers
    pub allow_offers: bool,
    // Royalty percentage in basis points (0-10000)
    pub royalty_basis_points: u16,
    // PDA bump seed
    pub bump: u8,
}

/// Marketplace offer on a listing
#[account]
pub struct MarketplaceOffer {
    // Reference to the listing
    pub listing: Pubkey,
    // The ticket the offer is for
    pub ticket: Pubkey,
    // Person making the offer
    pub buyer: Pubkey,
    // Amount of the offer
    pub amount: u64,
    // When the offer was created
    pub created_at: i64,
    // When the offer expires
    pub expiry: Option<i64>,
    // Status of the offer
    pub status: OfferStatus,
    // PDA bump seed
    pub bump: u8,
}

/// Status of an offer
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum OfferStatus {
    // Offer is active and can be accepted
    Active,
    // Offer was accepted by seller
    Accepted,
    // Offer was declined by seller
    Declined,
    // Offer was canceled by buyer
    Canceled,
    // Offer expired
    Expired,
}

/// Bid information for auctions
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BidInfo {
    // Bidder public key
    pub bidder: Pubkey,
    // Bid amount
    pub amount: u64,
    // Timestamp of the bid
    pub timestamp: i64,
}

/// Auction history
#[account]
pub struct AuctionHistory {
    // Reference to the listing
    pub listing: Pubkey,
    // List of bids in chronological order
    pub bids: Vec<BidInfo>,
    // PDA bump seed
    pub bump: u8,
}

impl MarketplaceOffer {
    // Space needed for the offer account
    pub const SPACE: usize = 8 + // discriminator
        32 + // listing
        32 + // ticket
        32 + // buyer
        8 +  // amount
        8 +  // created_at
        9 +  // expiry (Option<i64>)
        1 +  // status
        1 +  // bump
        50;  // padding
}

impl MarketplaceListing {
    // Space needed for the listing account
    pub const SPACE: usize = 8 + // discriminator
        4 + 40 + // listing_id
        32 + // ticket
        32 + // mint
        32 + // owner
        32 + // event
        1 +  // listing_type
        1 +  // status
        8 +  // price
        9 +  // ending_price (Option<u64>)
        9 +  // min_bid_increment (Option<u64>)
        8 +  // created_at
        9 +  // expiry (Option<i64>)
        9 +  // highest_bid (Option<u64>)
        33 + // highest_bidder (Option<Pubkey>)
        1 +  // allow_offers
        2 +  // royalty_basis_points
        1 +  // bump
        50;  // padding
}

impl AuctionHistory {
    // Space needed for the auction history account
    pub fn space(max_bids: usize) -> usize {
        8 + // discriminator
        32 + // listing
        4 + (max_bids * (32 + 8 + 8)) + // bids vec with BidInfo structs
        1 + // bump
        50 // padding
    }

    // Maximum number of tracked bids
    pub const MAX_BIDS: usize = 20;
}

// Event emitted when a listing is created
#[event]
pub struct ListingCreatedEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub owner: Pubkey,
    pub price: u64,
    pub listing_type: String,
}

// Event emitted when a listing is canceled
#[event]
pub struct ListingCanceledEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub owner: Pubkey,
}

// Event emitted when a listing is purchased
#[event]
pub struct ListingPurchasedEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub royalty_amount: u64,
}

// Event emitted when a bid is placed
#[event]
pub struct BidPlacedEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
}

// Event emitted when an auction is settled
#[event]
pub struct AuctionSettledEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub winner: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub royalty_amount: u64,
}

// Event emitted when an auction expires with no bids
#[event]
pub struct AuctionExpiredEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
}

// Event emitted when an offer is made
#[event]
pub struct OfferMadeEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
}

// Event emitted when an offer is accepted
#[event]
pub struct OfferAcceptedEvent {
    #[index]
    pub listing: Pubkey,
    pub ticket: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub royalty_amount: u64,
}

/// Error specific to marketplace operations
#[error_code]
pub enum MarketplaceError {
    // Bid is lower than minimum allowed
    #[msg("Bid amount is too low")]
    BidTooLow,

    // Auction is not active
    #[msg("Auction is not active")]
    AuctionNotActive,
    
    // Auction has not ended yet
    #[msg("Auction has not ended yet")]
    AuctionNotEnded,
    
    // Auction has already ended
    #[msg("Auction has already ended")]
    AuctionEnded,
    
    // Cannot cancel auction with bids
    #[msg("Cannot cancel an auction with active bids")]
    CannotCancelWithBids,
    
    // Listing has invalid status
    #[msg("Listing has invalid status for this operation")]
    InvalidListingStatus,
    
    // Offers are not allowed on this listing
    #[msg("Offers are not allowed on this listing")]
    OffersNotAllowed,
}

/// Context for creating a marketplace listing
#[derive(Accounts)]
#[instruction(listing_id: String)]
pub struct CreateListing<'info> {
    // The ticket being listed
    pub ticket: Account<'info, Ticket>,
    
    // The mint of the ticket NFT
    pub mint: Account<'info, Mint>,
    
    // The listing account to be created
    #[account(
        init,
        payer = owner,
        space = MarketplaceListing::SPACE,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing_id.as_bytes()],
        bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // Optional auction history account (for auction listings)
    #[account(
        init,
        payer = owner,
        space = AuctionHistory::space(AuctionHistory::MAX_BIDS),
        seeds = [b"auction_history", listing.key().as_ref()],
        bump
    )]
    pub auction_history: Option<Account<'info, AuctionHistory>>,
    
    // The event the ticket belongs to
    pub event: Account<'info, Event>,
    
    // The owner of the ticket and seller
    #[account(mut, constraint = owner.key() == ticket.owner)]
    pub owner: Signer<'info>,
    
    // System program
    pub system_program: Program<'info, System>,
}

/// Context for canceling a marketplace listing
#[derive(Accounts)]
pub struct CancelListing<'info> {
    // The ticket being listed
    pub ticket: Account<'info, Ticket>,
    
    // The listing account
    #[account(
        mut,
        constraint = listing.ticket == ticket.key(),
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The owner of the ticket and seller
    #[account(constraint = owner.key() == listing.owner)]
    pub owner: Signer<'info>,
}

/// Context for purchasing a fixed-price listing
#[derive(Accounts)]
pub struct PurchaseListing<'info> {
    // The ticket being purchased
    #[account(
        mut,
        constraint = ticket.key() == listing.ticket,
        constraint = ticket.owner == listing.owner
    )]
    pub ticket: Account<'info, Ticket>,
    
    // The listing being purchased
    #[account(
        mut,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The mint of the ticket NFT
    pub mint: Account<'info, Mint>,
    
    // The seller's token account
    #[account(
        mut,
        constraint = from_token_account.owner == seller.key(),
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    // The buyer's token account
    #[account(
        mut,
        constraint = to_token_account.owner == buyer.key(),
        constraint = to_token_account.mint == mint.key()
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    // The seller of the ticket
    #[account(constraint = seller.key() == listing.owner)]
    pub seller: Signer<'info>,
    
    // The buyer of the ticket
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    // Payment from account (buyer)
    #[account(
        mut,
        constraint = payment_from_account.owner == buyer.key()
    )]
    pub payment_from_account: Account<'info, TokenAccount>,
    
    // Payment to account (seller)
    #[account(
        mut,
        constraint = payment_to_account.owner == seller.key()
    )]
    pub payment_to_account: Account<'info, TokenAccount>,
    
    // Optional royalty account
    #[account(mut)]
    pub royalty_account: Option<Account<'info, TokenAccount>>,
    
    // Optional transfer record account
    #[account(mut)]
    pub transfer_record: Option<Account<'info, TransferRecord>>,
    
    // Token program
    pub token_program: Program<'info, Token>,
    
    // Associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context for placing a bid on an auction
#[derive(Accounts)]
pub struct PlaceBid<'info> {
    // The ticket being auctioned
    #[account(constraint = ticket.key() == listing.ticket)]
    pub ticket: Account<'info, Ticket>,
    
    // The auction listing
    #[account(
        mut,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The auction history account
    #[account(
        mut,
        seeds = [b"auction_history", listing.key().as_ref()],
        bump = auction_history.bump
    )]
    pub auction_history: Account<'info, AuctionHistory>,
    
    // The bidder
    #[account(mut)]
    pub bidder: Signer<'info>,
    
    // Payment from account (bidder)
    #[account(
        mut,
        constraint = payment_from_account.owner == bidder.key()
    )]
    pub payment_from_account: Account<'info, TokenAccount>,
    
    // Escrow account to hold bid
    #[account(mut)]
    pub escrow_account: Account<'info, TokenAccount>,
    
    // The PDA that acts as the escrow authority
    /// CHECK: This is a PDA, we verify its derivation
    #[account(
        seeds = [b"escrow", listing.key().as_ref()],
        bump = escrow_authority_bump
    )]
    pub escrow_authority: UncheckedAccount<'info>,
    
    // To refund the previous bidder
    #[account(mut)]
    pub refund_account: Option<Account<'info, TokenAccount>>,
    
    // The escrow authority bump
    #[account(address = System::id())]
    pub escrow_authority_bump: u8,
    
    // Token program
    pub token_program: Program<'info, Token>,
}

/// Context for settling an auction
#[derive(Accounts)]
pub struct SettleAuction<'info> {
    // The ticket being auctioned
    #[account(
        mut,
        constraint = ticket.key() == listing.ticket,
        constraint = ticket.owner == seller.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    // The auction listing
    #[account(
        mut,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The mint of the ticket NFT
    pub mint: Account<'info, Mint>,
    
    // The seller's token account
    #[account(
        mut,
        constraint = from_token_account.owner == seller.key(),
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    // The highest bidder's token account
    #[account(
        mut,
        constraint = to_token_account.mint == mint.key()
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    // The seller of the ticket
    #[account(constraint = seller.key() == listing.owner)]
    pub seller: Signer<'info>,
    
    // The escrow account holding the funds
    #[account(mut)]
    pub escrow_account: Account<'info, TokenAccount>,
    
    // The PDA that acts as the escrow authority
    /// CHECK: This is a PDA, we verify its derivation
    #[account(
        seeds = [b"escrow", listing.key().as_ref()],
        bump = escrow_authority_bump
    )]
    pub escrow_authority: UncheckedAccount<'info>,
    
    // Payment to account (seller)
    #[account(
        mut,
        constraint = payment_to_account.owner == seller.key()
    )]
    pub payment_to_account: Account<'info, TokenAccount>,
    
    // Optional royalty account
    #[account(mut)]
    pub royalty_account: Option<Account<'info, TokenAccount>>,
    
    // Optional transfer record account
    #[account(mut)]
    pub transfer_record: Option<Account<'info, TransferRecord>>,
    
    // The escrow authority bump
    #[account(address = System::id())]
    pub escrow_authority_bump: u8,
    
    // Token program
    pub token_program: Program<'info, Token>,
    
    // Associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context for making an offer on a listing
#[derive(Accounts)]
pub struct MakeOffer<'info> {
    // The ticket the offer is for
    #[account(constraint = ticket.key() == listing.ticket)]
    pub ticket: Account<'info, Ticket>,
    
    // The listing the offer is for
    #[account(
        constraint = listing.status == ListingStatus::Active,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The offer account to create
    #[account(
        init,
        payer = buyer,
        space = MarketplaceOffer::SPACE,
        seeds = [b"marketplace_offer", listing.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub offer: Account<'info, MarketplaceOffer>,
    
    // The buyer making the offer
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    // System program
    pub system_program: Program<'info, System>,
}

/// Context for accepting an offer
#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    // The ticket being sold
    #[account(
        mut,
        constraint = ticket.key() == listing.ticket,
        constraint = ticket.owner == seller.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    // The listing
    #[account(
        mut,
        seeds = [b"marketplace_listing", ticket.key().as_ref(), listing.listing_id.as_bytes()],
        bump = listing.bump
    )]
    pub listing: Account<'info, MarketplaceListing>,
    
    // The offer being accepted
    #[account(
        mut,
        constraint = offer.listing == listing.key(),
        constraint = offer.ticket == ticket.key(),
        constraint = offer.status == OfferStatus::Active,
        seeds = [b"marketplace_offer", listing.key().as_ref(), offer.buyer.as_ref()],
        bump = offer.bump
    )]
    pub offer: Account<'info, MarketplaceOffer>,
    
    // The mint of the ticket NFT
    pub mint: Account<'info, Mint>,
    
    // The seller's token account
    #[account(
        mut,
        constraint = from_token_account.owner == seller.key(),
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    // The buyer's token account
    #[account(
        mut,
        constraint = to_token_account.owner == offer.buyer,
        constraint = to_token_account.mint == mint.key()
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    // The seller of the ticket
    #[account(constraint = seller.key() == listing.owner)]
    pub seller: Signer<'info>,
    
    // Payment from account (buyer)
    #[account(
        mut,
        constraint = payment_from_account.owner == offer.buyer
    )]
    pub payment_from_account: Account<'info, TokenAccount>,
    
    // Payment to account (seller)
    #[account(
        mut,
        constraint = payment_to_account.owner == seller.key()
    )]
    pub payment_to_account: Account<'info, TokenAccount>,
    
    // Optional royalty account
    #[account(mut)]
    pub royalty_account: Option<Account<'info, TokenAccount>>,
    
    // Optional transfer record account
    #[account(mut)]
    pub transfer_record: Option<Account<'info, TransferRecord>>,
    
    // Token program
    pub token_program: Program<'info, Token>,
    
    // Associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// Implement extension method for TransferRecord to add a transfer
impl TransferRecord {
    pub fn add_transfer(
        &mut self,
        from: Pubkey,
        to: Pubkey,
        price: u64,
        timestamp: i64,
        transfer_type: TransferType,
    ) -> Result<()> {
        // Check if we have space
        if self.history.len() >= 10 {
            return err!(TicketError::TransferRecordFull);
        }
        
        // Add the transfer
        self.history.push(crate::TransferDetail {
            from,
            to,
            price,
            timestamp,
            transfer_type,
        });
        
        Ok(())
    }
}

/// Creates a fixed-price marketplace listing
pub fn create_listing(
    ctx: Context<CreateListing>,
    listing_id: String,
    price: u64,
) -> Result<()> {
    // Get current timestamp
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if the ticket is transferable
    let ticket = &ctx.accounts.ticket;
    if !ticket.transferable {
        return err!(TicketError::NotTransferable);
    }
    
    // Check that the ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Check if the seller is the ticket owner
    if ticket.owner != ctx.accounts.owner.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Get the event account to read royalty information
    let event = &ctx.accounts.event;
    
    // Initialize the listing
    let listing = &mut ctx.accounts.listing;
    listing.listing_id = listing_id;
    listing.ticket = ctx.accounts.ticket.key();
    listing.mint = ctx.accounts.mint.key();
    listing.owner = ctx.accounts.owner.key();
    listing.event = ctx.accounts.event.key();
    listing.listing_type = ListingType::FixedPrice;
    listing.status = ListingStatus::Active;
    listing.price = price;
    listing.ending_price = None;
    listing.min_bid_increment = None;
    listing.created_at = current_time;
    listing.expiry = None; // No expiration by default
    listing.highest_bid = None;
    listing.highest_bidder = None;
    listing.allow_offers = true;
    listing.royalty_basis_points = event.royalty_basis_points;
    listing.bump = *ctx.bumps.get("listing").unwrap();
    
    // Emit event
    emit!(ListingCreatedEvent {
        listing: listing.key(),
        ticket: ctx.accounts.ticket.key(),
        owner: ctx.accounts.owner.key(),
        price,
        listing_type: "fixed_price".to_string(),
    });
    
    Ok(())
}

/// Creates an auction listing
pub fn create_auction(
    ctx: Context<CreateListing>,
    listing_id: String,
    start_price: u64,
    min_bid_increment: u64,
    duration_seconds: i64,
) -> Result<()> {
    // Get current timestamp
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if the ticket is transferable
    let ticket = &ctx.accounts.ticket;
    if !ticket.transferable {
        return err!(TicketError::NotTransferable);
    }
    
    // Check that the ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Check if the seller is the ticket owner
    if ticket.owner != ctx.accounts.owner.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Get the event account to read royalty information
    let event = &ctx.accounts.event;
    
    // Initialize the listing
    let listing = &mut ctx.accounts.listing;
    listing.listing_id = listing_id;
    listing.ticket = ctx.accounts.ticket.key();
    listing.mint = ctx.accounts.mint.key();
    listing.owner = ctx.accounts.owner.key();
    listing.event = ctx.accounts.event.key();
    listing.listing_type = ListingType::Auction;
    listing.status = ListingStatus::AuctionActive;
    listing.price = start_price;
    listing.ending_price = None;
    listing.min_bid_increment = Some(min_bid_increment);
    listing.created_at = current_time;
    listing.expiry = Some(current_time + duration_seconds);
    listing.highest_bid = None;
    listing.highest_bidder = None;
    listing.allow_offers = false;
    listing.royalty_basis_points = event.royalty_basis_points;
    listing.bump = *ctx.bumps.get("listing").unwrap();
    
    // Create auction history account if provided
    if let Some(auction_history) = &mut ctx.accounts.auction_history {
        auction_history.listing = listing.key();
        auction_history.bids = Vec::new();
        auction_history.bump = *ctx.bumps.get("auction_history").unwrap();
    }
    
    // Emit event
    emit!(ListingCreatedEvent {
        listing: listing.key(),
        ticket: ctx.accounts.ticket.key(),
        owner: ctx.accounts.owner.key(),
        price: start_price,
        listing_type: "auction".to_string(),
    });
    
    Ok(())
}

/// Creates a Dutch auction (price decreases over time)
pub fn create_dutch_auction(
    ctx: Context<CreateListing>,
    listing_id: String,
    start_price: u64,
    end_price: u64,
    duration_seconds: i64,
) -> Result<()> {
    // Validate inputs
    if end_price >= start_price {
        return err!(TicketError::InvalidAttribute);
    }
    
    // Get current timestamp
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    
    // Check if the ticket is transferable
    let ticket = &ctx.accounts.ticket;
    if !ticket.transferable {
        return err!(TicketError::NotTransferable);
    }
    
    // Check that the ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Check if the seller is the ticket owner
    if ticket.owner != ctx.accounts.owner.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Get the event account to read royalty information
    let event = &ctx.accounts.event;
    
    // Initialize the listing
    let listing = &mut ctx.accounts.listing;
    listing.listing_id = listing_id;
    listing.ticket = ctx.accounts.ticket.key();
    listing.mint = ctx.accounts.mint.key();
    listing.owner = ctx.accounts.owner.key();
    listing.event = ctx.accounts.event.key();
    listing.listing_type = ListingType::DutchAuction;
    listing.status = ListingStatus::AuctionActive;
    listing.price = start_price;
    listing.ending_price = Some(end_price);
    listing.min_bid_increment = None;
    listing.created_at = current_time;
    listing.expiry = Some(current_time + duration_seconds);
    listing.highest_bid = None;
    listing.highest_bidder = None;
    listing.allow_offers = false;
    listing.royalty_basis_points = event.royalty_basis_points;
    listing.bump = *ctx.bumps.get("listing").unwrap();
    
// Create auction history account if provided
    if let Some(auction_history) = &mut ctx.accounts.auction_history {
        auction_history.listing = listing.key();
        auction_history.bids = Vec::new();
        auction_history.bump = *ctx.bumps.get("auction_history").unwrap();
    }
    
    // Emit event
    emit!(ListingCreatedEvent {
        listing: listing.key(),
        ticket: ctx.accounts.ticket.key(),
        owner: ctx.accounts.owner.key(),
        price: start_price,
        listing_type: "dutch_auction".to_string(),
    });
    
    Ok(())
}

/// Cancel a marketplace listing
pub fn cancel_listing(
    ctx: Context<CancelListing>,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    
    // Check if listing belongs to the owner
    if listing.owner != ctx.accounts.owner.key() {
        return err!(TicketError::Unauthorized);
    }
    
    // Check if listing can be canceled
    match listing.status {
        ListingStatus::Active | ListingStatus::AuctionActive => {
            // For auctions, check if there are bids
            if listing.listing_type != ListingType::FixedPrice && listing.highest_bid.is_some() {
                return err!(MarketplaceError::CannotCancelWithBids);
            }
            
            // Update listing status
            listing.status = if listing.listing_type == ListingType::FixedPrice {
                ListingStatus::Canceled
            } else {
                ListingStatus::AuctionExpired
            };
            
            // Emit event
            emit!(ListingCanceledEvent {
                listing: listing.key(),
                ticket: ctx.accounts.ticket.key(),
                owner: ctx.accounts.owner.key(),
            });
            
            Ok(())
        },
        _ => err!(MarketplaceError::InvalidListingStatus),
    }
}

/// Purchase a fixed-price listing
pub fn purchase_listing(
    ctx: Context<PurchaseListing>,
) -> Result<()> {
    let listing = &ctx.accounts.listing;
    let ticket = &mut ctx.accounts.ticket;
    
    // Check if listing is active
    if listing.status != ListingStatus::Active {
        return err!(TicketError::ListingInactive);
    }
    
    // Check if listing has expired (if expiry is set)
    if let Some(expiry) = listing.expiry {
        let current_time = Clock::get()?.unix_timestamp;
        if current_time > expiry {
            return err!(TicketError::ListingExpired);
        }
    }
    
    // Check if ticket is still owned by the seller
    if ticket.owner != listing.owner {
        return err!(TicketError::TicketOwnerChanged);
    }
    
    // Check that the ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Transfer the NFT token
    let transfer_ix = token::Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_ix,
        ),
        1, // NFTs have an amount of 1
    )?;
    
    // Update ticket owner
    let previous_owner = ticket.owner;
    ticket.owner = ctx.accounts.buyer.key();
    
    // Process payment
    let payment_amount = listing.price;
    
    // Calculate royalty amount
    let royalty_amount = if listing.royalty_basis_points > 0 {
        (payment_amount as u128)
            .checked_mul(listing.royalty_basis_points as u128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0) as u64
    } else {
        0
    };
    
    // Calculate seller amount (after royalties)
    let seller_amount = payment_amount.saturating_sub(royalty_amount);
    
    // Transfer payment to seller
    let payment_ix = token::Transfer {
        from: ctx.accounts.payment_from_account.to_account_info(),
        to: ctx.accounts.payment_to_account.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            payment_ix,
        ),
        seller_amount,
    )?;
    
    // If royalties are due, transfer them to the royalty account
    if royalty_amount > 0 && ctx.accounts.royalty_account.is_some() {
        let royalty_ix = token::Transfer {
            from: ctx.accounts.payment_from_account.to_account_info(),
            to: ctx.accounts.royalty_account.as_ref().unwrap().to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                royalty_ix,
            ),
            royalty_amount,
        )?;
    }
    
    // Record transfer in history if available
    if let Some(transfer_record) = &mut ctx.accounts.transfer_record {
        transfer_record.add_transfer(
            previous_owner,
            ctx.accounts.buyer.key(),
            payment_amount,
            Clock::get()?.unix_timestamp,
            TransferType::Sale,
        )?;
    }
    
    // Update listing status
    let listing_mut = &mut ctx.accounts.listing;
    listing_mut.status = ListingStatus::Sold;
    
    // Emit purchase event
    emit!(ListingPurchasedEvent {
        listing: listing.key(),
        ticket: ticket.key(),
        buyer: ctx.accounts.buyer.key(),
        seller: listing.owner,
        price: payment_amount,
        royalty_amount,
    });
    
    Ok(())
}

/// Place a bid on an auction
pub fn place_bid(
    ctx: Context<PlaceBid>,
    bid_amount: u64,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    let auction_history = &mut ctx.accounts.auction_history;
    
    // Check if auction is active
    if listing.status != ListingStatus::AuctionActive {
        return err!(MarketplaceError::AuctionNotActive);
    }
    
    // Check if auction has expired
    let current_time = Clock::get()?.unix_timestamp;
    if let Some(expiry) = listing.expiry {
        if current_time > expiry {
            return err!(MarketplaceError::AuctionEnded);
        }
    }
    
    // For Dutch auctions, calculate current price
    let current_price = if listing.listing_type == ListingType::DutchAuction {
        let start_time = listing.created_at;
        let end_time = listing.expiry.unwrap();
        let start_price = listing.price;
        let end_price = listing.ending_price.unwrap();
        
        if current_time >= end_time {
            end_price
        } else {
            // Linear interpolation of price
            let elapsed = current_time - start_time;
            let duration = end_time - start_time;
            let price_diff = start_price.saturating_sub(end_price);
            
            let price_reduction = (price_diff as u128)
                .checked_mul(elapsed as u128)
                .unwrap_or(0)
                .checked_div(duration as u128)
                .unwrap_or(0) as u64;
            
            start_price.saturating_sub(price_reduction)
        }
    } else {
        // For regular auctions, check against highest bid
        match listing.highest_bid {
            Some(highest_bid) => {
                let min_increment = listing.min_bid_increment.unwrap_or(1);
                highest_bid.saturating_add(min_increment)
            },
            None => listing.price
        }
    };
    
    // Check if bid is high enough
    if bid_amount < current_price {
        return err!(MarketplaceError::BidTooLow);
    }
    
    // For regular auctions, check against minimum increment
    if listing.listing_type == ListingType::Auction && listing.highest_bid.is_some() {
        let min_increment = listing.min_bid_increment.unwrap_or(1);
        let min_bid = listing.highest_bid.unwrap().saturating_add(min_increment);
        
        if bid_amount < min_bid {
            return err!(MarketplaceError::BidTooLow);
        }
    }
    
    // Process payment for new bid
    // This will be held in escrow until auction ends or outbid
    let payment_ix = token::Transfer {
        from: ctx.accounts.payment_from_account.to_account_info(),
        to: ctx.accounts.escrow_account.to_account_info(),
        authority: ctx.accounts.bidder.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            payment_ix,
        ),
        bid_amount,
    )?;
    
    // Refund previous bidder if there was one
    if let Some(previous_bidder) = &listing.highest_bidder {
        if previous_bidder != &ctx.accounts.bidder.key() && listing.highest_bid.is_some() {
            // Find previous bidder's token account
            if let Some(refund_account) = &ctx.accounts.refund_account {
                // Refund previous bid
                let refund_ix = token::Transfer {
                    from: ctx.accounts.escrow_account.to_account_info(),
                    to: refund_account.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                };
                
                // Get escrow authority signer seeds
                let escrow_bump = ctx.accounts.escrow_authority_bump;
                let seeds = &[
                    b"escrow",
                    listing.key().as_ref(),
                    &[escrow_bump],
                ];
                let signer = &[&seeds[..]];
                
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        refund_ix,
                        signer,
                    ),
                    listing.highest_bid.unwrap(),
                )?;
            }
        }
    }
    
    // Update listing with new highest bid
    listing.highest_bid = Some(bid_amount);
    listing.highest_bidder = Some(ctx.accounts.bidder.key());
    
    // Add bid to auction history
    if auction_history.bids.len() < AuctionHistory::MAX_BIDS {
        auction_history.bids.push(BidInfo {
            bidder: ctx.accounts.bidder.key(),
            amount: bid_amount,
            timestamp: current_time,
        });
    }
    
    // Emit bid event
    emit!(BidPlacedEvent {
        listing: listing.key(),
        ticket: ctx.accounts.ticket.key(),
        bidder: ctx.accounts.bidder.key(),
        amount: bid_amount,
    });
    
    Ok(())
}

/// Settle an auction after it ends
pub fn settle_auction(
    ctx: Context<SettleAuction>,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    let ticket = &mut ctx.accounts.ticket;
    
    // Check if auction is ready to settle
    if listing.status != ListingStatus::AuctionActive {
        return err!(MarketplaceError::AuctionNotActive);
    }
    
    // Check if auction has ended
    let current_time = Clock::get()?.unix_timestamp;
    if let Some(expiry) = listing.expiry {
        if current_time <= expiry {
            return err!(MarketplaceError::AuctionNotEnded);
        }
    } else {
        return err!(MarketplaceError::AuctionNotEnded);
    }
    
    // Check if there were any bids
    if listing.highest_bid.is_none() || listing.highest_bidder.is_none() {
        // No bids, update listing status
        listing.status = ListingStatus::AuctionExpired;
        
        // Emit event
        emit!(AuctionExpiredEvent {
            listing: listing.key(),
            ticket: ticket.key(),
        });
        
        return Ok(());
    }
    
    // Transfer the NFT token to the highest bidder
    let transfer_ix = token::Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_ix,
        ),
        1, // NFTs have an amount of 1
    )?;
    
    // Update ticket owner
    let previous_owner = ticket.owner;
    ticket.owner = listing.highest_bidder.unwrap();
    
    // Process payment
    let payment_amount = listing.highest_bid.unwrap();
    
    // Calculate royalty amount
    let royalty_amount = if listing.royalty_basis_points > 0 {
        (payment_amount as u128)
            .checked_mul(listing.royalty_basis_points as u128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0) as u64
    } else {
        0
    };
    
    // Calculate seller amount (after royalties)
    let seller_amount = payment_amount.saturating_sub(royalty_amount);
    
    // Transfer funds from escrow to seller
    let payment_ix = token::Transfer {
        from: ctx.accounts.escrow_account.to_account_info(),
        to: ctx.accounts.payment_to_account.to_account_info(),
        authority: ctx.accounts.escrow_authority.to_account_info(),
    };
    
    // Get escrow authority signer seeds
    let escrow_bump = ctx.accounts.escrow_authority_bump;
    let seeds = &[
        b"escrow",
        listing.key().as_ref(),
        &[escrow_bump],
    ];
    let signer = &[&seeds[..]];
    
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            payment_ix,
            signer,
        ),
        seller_amount,
    )?;
    
    // If royalties are due, transfer them to the royalty account
    if royalty_amount > 0 && ctx.accounts.royalty_account.is_some() {
        let royalty_ix = token::Transfer {
            from: ctx.accounts.escrow_account.to_account_info(),
            to: ctx.accounts.royalty_account.as_ref().unwrap().to_account_info(),
            authority: ctx.accounts.escrow_authority.to_account_info(),
        };
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                royalty_ix,
                signer,
            ),
            royalty_amount,
        )?;
    }
    
    // Record transfer in history if available
    if let Some(transfer_record) = &mut ctx.accounts.transfer_record {
        transfer_record.add_transfer(
            previous_owner,
            listing.highest_bidder.unwrap(),
            payment_amount,
            current_time,
            TransferType::Sale,
        )?;
    }
    
    // Update listing status
    listing.status = ListingStatus::AuctionEnded;
    
    // Emit auction settled event
    emit!(AuctionSettledEvent {
        listing: listing.key(),
        ticket: ticket.key(),
        winner: listing.highest_bidder.unwrap(),
        seller: previous_owner,
        price: payment_amount,
        royalty_amount,
    });
    
    Ok(())
}

/// Make an offer on a listing
pub fn make_offer(
    ctx: Context<MakeOffer>,
    offer_amount: u64,
    expiry_seconds: Option<i64>,
) -> Result<()> {
    let listing = &ctx.accounts.listing;
    
    // Check if listing allows offers
    if !listing.allow_offers {
        return err!(MarketplaceError::OffersNotAllowed);
    }
    
    // Check if listing is active
    if listing.status != ListingStatus::Active {
        return err!(TicketError::ListingInactive);
    }
    
    // Validate offer amount
    if offer_amount == 0 {
        return err!(TicketError::InvalidAttribute);
    }
    
    // Calculate expiry
    let current_time = Clock::get()?.unix_timestamp;
    let expiry = expiry_seconds.map(|seconds| current_time + seconds);
    
    // Initialize offer
    let offer = &mut ctx.accounts.offer;
    offer.listing = listing.key();
    offer.ticket = listing.ticket;
    offer.buyer = ctx.accounts.buyer.key();
    offer.amount = offer_amount;
    offer.created_at = current_time;
    offer.expiry = expiry;
    offer.status = OfferStatus::Active;
    offer.bump = *ctx.bumps.get("offer").unwrap();
    
    // Emit offer event
    emit!(OfferMadeEvent {
        listing: listing.key(),
        ticket: listing.ticket,
        buyer: ctx.accounts.buyer.key(),
        amount: offer_amount,
    });
    
    Ok(())
}

/// Accept an offer
pub fn accept_offer(
    ctx: Context<AcceptOffer>,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    let offer = &mut ctx.accounts.offer;
    let ticket = &mut ctx.accounts.ticket;
    
    // Check if offer is still active
    if offer.status != OfferStatus::Active {
        return err!(TicketError::OfferInactive);
    }
    
    // Check if offer has expired
    if let Some(expiry) = offer.expiry {
        let current_time = Clock::get()?.unix_timestamp;
        if current_time > expiry {
            offer.status = OfferStatus::Expired;
            return err!(TicketError::OfferExpired);
        }
    }
    
    // Check if listing is still active
    if listing.status != ListingStatus::Active {
        return err!(TicketError::ListingInactive);
    }
    
    // Check if ticket is still owned by seller
    if ticket.owner != ctx.accounts.seller.key() {
        return err!(TicketError::TicketOwnerChanged);
    }
    
    // Check that the ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Transfer the NFT token
    let transfer_ix = token::Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_ix,
        ),
        1, // NFTs have an amount of 1
    )?;
    
    // Update ticket owner
    let previous_owner = ticket.owner;
    ticket.owner = offer.buyer;
    
    // Process payment
    let payment_amount = offer.amount;
    
    // Calculate royalty amount
    let royalty_amount = if listing.royalty_basis_points > 0 {
        (payment_amount as u128)
            .checked_mul(listing.royalty_basis_points as u128)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0) as u64
    } else {
        0
    };
    
    // Calculate seller amount (after royalties)
    let seller_amount = payment_amount.saturating_sub(royalty_amount);
    
    // Transfer payment to seller
    let payment_ix = token::Transfer {
        from: ctx.accounts.payment_from_account.to_account_info(),
        to: ctx.accounts.payment_to_account.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            payment_ix,
        ),
        seller_amount,
    )?;
    
    // If royalties are due, transfer them to the royalty account
    if royalty_amount > 0 && ctx.accounts.royalty_account.is_some() {
        let royalty_ix = token::Transfer {
            from: ctx.accounts.payment_from_account.to_account_info(),
            to: ctx.accounts.royalty_account.as_ref().unwrap().to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                royalty_ix,
            ),
            royalty_amount,
        )?;
    }
    
    // Record transfer in history if available
    if let Some(transfer_record) = &mut ctx.accounts.transfer_record {
        transfer_record.add_transfer(
            previous_owner,
            offer.buyer,
            payment_amount,
            Clock::get()?.unix_timestamp,
            TransferType::Sale,
        )?;
    }
    
    // Update offer status
    offer.status = OfferStatus::Accepted;
    
    // Update listing status
    listing.status = ListingStatus::Sold;
    
    // Emit offer accepted event
    emit!(OfferAcceptedEvent {
        listing: listing.key(),
        ticket: ticket.key(),
        buyer: offer.buyer,
        seller: previous_owner,
        amount: payment_amount,
        royalty_amount,
    });
    
    Ok(())
}

// Add the following line to mod.rs or lib.rs to include this module
// pub mod marketplace;

// Add the following functions to program module in lib.rs to expose the instructions:
/*
pub fn create_listing(ctx: Context<CreateListing>, listing_id: String, price: u64) -> Result<()> {
    instructions::marketplace::create_listing(ctx, listing_id, price)
}

pub fn create_auction(ctx: Context<CreateListing>, listing_id: String, start_price: u64, min_bid_increment: u64, duration_seconds: i64) -> Result<()> {
    instructions::marketplace::create_auction(ctx, listing_id, start_price, min_bid_increment, duration_seconds)
}

pub fn create_dutch_auction(ctx: Context<CreateListing>, listing_id: String, start_price: u64, end_price: u64, duration_seconds: i64) -> Result<()> {
    instructions::marketplace::create_dutch_auction(ctx, listing_id, start_price, end_price, duration_seconds)
}

pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    instructions::marketplace::cancel_listing(ctx)
}

pub fn purchase_listing(ctx: Context<PurchaseListing>) -> Result<()> {
    instructions::marketplace::purchase_listing(ctx)
}

pub fn place_bid(ctx: Context<PlaceBid>, bid_amount: u64) -> Result<()> {
    instructions::marketplace::place_bid(ctx, bid_amount)
}

pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
    instructions::marketplace::settle_auction(ctx)
}

pub fn make_offer(ctx: Context<MakeOffer>, offer_amount: u64, expiry_seconds: Option<i64>) -> Result<()> {
    instructions::marketplace::make_offer(ctx, offer_amount, expiry_seconds)
}

pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
    instructions::marketplace::accept_offer(ctx)
}
*/
