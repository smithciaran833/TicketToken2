use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    
    /// The listing to cancel
    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        has_one = seller,
        constraint = listing.is_active @ MarketplaceError::ListingNotActive
    )]
    pub listing: Account<'info, Listing>,
    
    /// Escrow token account holding the NFT
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    /// Seller's token account to receive NFT back
    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    /// The NFT mint
    pub mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CancelListing>) -> Result<()> {
    let listing = &ctx.accounts.listing;
    
    // For auctions, check if there are any bids
    if listing.listing_type == ListingType::Auction {
        let clock = Clock::get()?;
        if let Some(ref auction_config) = listing.auction_config {
            require!(
                clock.unix_timestamp < auction_config.start_time,
                MarketplaceError::AuctionNotStarted
            );
        }
    }

    // Transfer NFT back to seller
    let listing_seeds = &[
        b"listing",
        ctx.accounts.mint.key().as_ref(),
        &[listing.bump],
    ];
    let signer_seeds = &[&listing_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: listing.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, 1)?;

    // Mark listing as inactive
    let listing = &mut ctx.accounts.listing;
    listing.is_active = false;

    Ok(())
}
