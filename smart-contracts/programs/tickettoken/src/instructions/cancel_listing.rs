use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
        constraint = ticket_data.owner == seller.key() @ TicketTokenError::NotTicketOwner,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(
        mut,
        seeds = [b"marketplace_listing", ticket_data.mint.as_ref()],
        bump = marketplace_listing.bump,
        constraint = marketplace_listing.seller == seller.key() @ TicketTokenError::Unauthorized,
        constraint = marketplace_listing.is_active @ TicketTokenError::ListingNotActive,
        close = seller,
    )]
    pub marketplace_listing: Account<'info, MarketplaceListing>,

    #[account(mut)]
    pub seller: Signer<'info>,
}

pub fn handler(ctx: Context<CancelListing>) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let marketplace_listing = &ctx.accounts.marketplace_listing;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    
    // Check if auction has bids (cannot cancel auction with bids)
    if matches!(marketplace_listing.listing_type, ListingType::Auction) {
        if marketplace_listing.highest_bid.is_some() {
            return Err(TicketTokenError::AuctionHasBids.into());
        }
    }
    
    // Mark ticket as no longer listed
    ticket_data.is_listed = false;
    
    msg!("Listing cancelled successfully for ticket: {}", ticket_data.mint);
    Ok(())
}
