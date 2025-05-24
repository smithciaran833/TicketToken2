use anchor_lang::prelude::*;
use solana_program::{system_instruction, program::invoke};
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    
    /// The marketplace configuration
    #[account(
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        constraint = !marketplace_config.is_paused @ MarketplaceError::MarketplacePaused
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    /// The listing for auction
    #[account(
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        constraint = listing.is_active @ MarketplaceError::ListingNotActive,
        constraint = listing.listing_type == ListingType::Auction @ MarketplaceError::NotAuctionListing,
        constraint = listing.seller != bidder.key() @ MarketplaceError::CannotBidOnOwnListing
    )]
    pub listing: Account<'info, Listing>,
    
    /// The bid account
    #[account(
        init,
        payer = bidder,
        space = 8 + Bid::INIT_SPACE,
        seeds = [b"bid", listing.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid: Account<'info, Bid>,
    
    /// Bid escrow PDA to hold funds
    #[account(
        init,
        payer = bidder,
        seeds = [b"bid_escrow", bid.key().as_ref()],
        bump,
        space = 0
    )]
    /// CHECK: PDA for holding bid funds
    pub bid_escrow: UncheckedAccount<'info>,
    
    /// The NFT mint
    pub mint: Account<'info, Mint>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
    let listing = &ctx.accounts.listing;
    let clock = Clock::get()?;
    
    // Check auction timing and bid requirements
    if let Some(ref auction_config) = listing.auction_config {
        require!(
            clock.unix_timestamp >= auction_config.start_time,
            MarketplaceError::AuctionNotStarted
        );
        require!(
            clock.unix_timestamp < auction_config.end_time,
            MarketplaceError::AuctionEnded
        );

        // Check minimum bid requirements
        require!(amount >= listing.price, MarketplaceError::BidTooLow);
        
        if let Some(reserve_price) = auction_config.reserve_price {
            require!(amount >= reserve_price, MarketplaceError::ReservePriceNotMet);
        }
    }

    // Transfer bid amount to escrow
    invoke(
        &system_instruction::transfer(
            &ctx.accounts.bidder.key(),
            &ctx.accounts.bid_escrow.key(),
            amount,
        ),
        &[
            ctx.accounts.bidder.to_account_info(),
            ctx.accounts.bid_escrow.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // Initialize bid
    let bid = &mut ctx.accounts.bid;
    bid.bidder = ctx.accounts.bidder.key();
    bid.listing = listing.key();
    bid.amount = amount;
    bid.created_at = clock.unix_timestamp;
    bid.is_active = true;
    bid.bump = *ctx.bumps.get("bid").unwrap();

    emit!(BidPlaced {
        listing: listing.key(),
        bidder: ctx.accounts.bidder.key(),
        amount,
    });

    Ok(())
}
