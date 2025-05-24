use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct CreateListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    
    /// The marketplace configuration
    #[account(
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump,
        constraint = !marketplace_config.is_paused @ MarketplaceError::MarketplacePaused
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    /// The listing account to be created
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", mint.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    
    /// The seller's token account (must own the NFT)
    #[account(
        mut,
        constraint = seller_token_account.mint == mint.key(),
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.amount == 1
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    /// Escrow token account to hold the NFT during listing
    #[account(
        init,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    /// The NFT mint
    pub mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateListing>,
    price: u64,
    listing_type: ListingType,
    auction_config: Option<AuctionConfig>,
    royalty_config: Option<RoyaltyConfig>,
) -> Result<()> {
    require!(price > 0, MarketplaceError::InsufficientFunds);

    // Validate auction config if auction listing
    if listing_type == ListingType::Auction {
        require!(auction_config.is_some(), MarketplaceError::InvalidFeePercentage);
        let config = auction_config.as_ref().unwrap();
        let clock = Clock::get()?;
        require!(config.start_time >= clock.unix_timestamp, MarketplaceError::AuctionNotStarted);
        require!(config.end_time > config.start_time, MarketplaceError::InvalidTimelockDuration);
    }

    // Validate royalty config
    if let Some(ref royalty) = royalty_config {
        require!(
            royalty.percentage_bps <= ctx.accounts.marketplace_config.max_royalty_bps,
            MarketplaceError::InvalidRoyaltyPercentage
        );
    }

    // Transfer NFT to escrow
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.seller_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, 1)?;

    // Initialize listing
    let listing = &mut ctx.accounts.listing;
    listing.seller = ctx.accounts.seller.key();
    listing.mint = ctx.accounts.mint.key();
    listing.price = price;
    listing.listing_type = listing_type;
    listing.created_at = Clock::get()?.unix_timestamp;
    listing.auction_config = auction_config;
    listing.royalty_config = royalty_config;
    listing.is_active = true;
    listing.bump = *ctx.bumps.get("listing").unwrap();

    emit!(ListingCreated {
        listing: listing.key(),
        seller: ctx.accounts.seller.key(),
        mint: ctx.accounts.mint.key(),
        price,
        listing_type,
    });

    Ok(())
}
