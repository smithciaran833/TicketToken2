use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct CreateListing<'info> {
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
        init,
        payer = seller,
        space = 8 + MarketplaceListing::LEN,
        seeds = [b"marketplace_listing", ticket_data.mint.as_ref()],
        bump,
    )]
    pub marketplace_listing: Account<'info, MarketplaceListing>,

    #[account(
        constraint = seller_token_account.mint == ticket_data.mint @ TicketTokenError::TicketMintMismatch,
        constraint = seller_token_account.owner == seller.key() @ TicketTokenError::TokenAccountMismatch,
        constraint = seller_token_account.amount == 1 @ TicketTokenError::InvalidTokenAmount,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateListing>,
    price: u64,
    listing_type: ListingType,
    duration: Option<i64>,
) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let marketplace_listing = &mut ctx.accounts.marketplace_listing;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(!ticket_data.is_used, TicketTokenError::TicketAlreadyUsed);
    require!(!ticket_data.is_listed, TicketTokenError::TicketCurrentlyListed);
    require!(price > 0, TicketTokenError::InvalidListingPrice);
    
    // Check if ticket is transferable
    match ticket_data.transfer_restrictions.transfer_type {
        AllowedTransferType::NoTransfer => {
            return Err(TicketTokenError::TransferNotAllowed.into());
        }
        _ => {}
    }
    
    let current_time = Clock::get()?.unix_timestamp;
    let expiry_timestamp = duration.map(|d| current_time + d);
    
    // Initialize marketplace listing
    marketplace_listing.ticket_mint = ticket_data.mint;
    marketplace_listing.seller = ctx.accounts.seller.key();
    marketplace_listing.price = price;
    marketplace_listing.listing_type = listing_type.clone();
    marketplace_listing.payment_token = None; // SOL by default
    marketplace_listing.created_timestamp = current_time;
    marketplace_listing.expiry_timestamp = expiry_timestamp;
    marketplace_listing.is_active = true;
    marketplace_listing.highest_bid = None;
    marketplace_listing.highest_bidder = None;
    marketplace_listing.bump = *ctx.bumps.get("marketplace_listing").unwrap();
    
    // Mark ticket as listed
    ticket_data.is_listed = true;
    
    emit!(TicketListed {
        mint: ticket_data.mint,
        seller: ctx.accounts.seller.key(),
        price,
        listing_type,
        timestamp: current_time,
    });
    
    msg!("Ticket listed successfully for {} lamports", price);
    Ok(())
}
