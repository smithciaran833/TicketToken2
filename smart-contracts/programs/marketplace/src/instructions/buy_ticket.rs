use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Token, Mint};
use anchor_spl::associated_token::AssociatedToken;

use crate::state::{Listing, ListingState, RoyaltyRecipient};
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// The listing being purchased
    #[account(
        mut,
        constraint = listing.state == ListingState::Active @ MarketplaceError::ListingNoLongerActive,
        constraint = listing.listing_type == crate::state::ListingType::FixedPrice,
        seeds = [b"listing", listing.ticket_mint.as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, Listing>,
    
    /// The seller who created the listing
    #[account(
        mut,
        constraint = seller.key() == listing.seller @ MarketplaceError::InvalidOwner
    )]
    pub seller: AccountInfo<'info>,
    
    /// The marketplace authority who receives the fee
    #[account(
        mut,
        constraint = marketplace_authority.key() == listing.marketplace_authority @ MarketplaceError::InvalidMarketplaceAuthority
    )]
    pub marketplace_authority: AccountInfo<'info>,
    
    /// The royalty recipient (for basic royalty distribution)
    #[account(
        mut,
        constraint = royalty_recipient.key() == listing.royalty_recipient @ MarketplaceError::InvalidRoyaltyRecipient
    )]
    pub royalty_recipient: AccountInfo<'info>,
    
    /// Multiple royalty recipients (only needed for enhanced royalty)
    /// If not using enhanced royalties, this can be empty
    pub royalty_recipients: Option<Vec<AccountInfo<'info>>>,
    
    /// The ticket mint
    #[account(
        constraint = ticket_mint.key() == listing.ticket_mint
    )]
    pub ticket_mint: Account<'info, Mint>,
    
    /// The escrow account holding the ticket NFT
    #[account(
        mut,
        constraint = escrow_token_account.mint == ticket_mint.key(),
        constraint = escrow_token_account.owner == listing.key()
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    /// The buyer's token account to receive the NFT
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = ticket_mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<BuyTicket>) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    
    // Validate the ticket can be transferred
    require!(listing.transferable, MarketplaceError::TicketNotTransferable);
    
    // Validate event hasn't started yet
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(now < listing.event_start_time, MarketplaceError::EventAlreadyStarted);
    
    // Get the sale price
    let price = listing.price;
    
    // Calculate marketplace fee
    let marketplace_fee = listing.calculate_marketplace_fee(price);
    
    // 1. Transfer marketplace fee
    if marketplace_fee > 0 {
        let marketplace_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.marketplace_authority.to_account_info(),
        };
        let marketplace_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            marketplace_accounts,
        );
        anchor_lang::system_program::transfer(marketplace_ctx, marketplace_fee)?;
    }
    
    // 2. Handle royalty distribution
    let mut royalty_fee = 0;
    
    // Check if we have enhanced royalty config
    if let Some(royalty_config) = &listing.royalty_config {
        // Validate we have the required recipient accounts
        if let Some(recipient_accounts) = &ctx.accounts.royalty_recipients {
            require!(
                recipient_accounts.len() == royalty_config.recipients.len(),
                MarketplaceError::InvalidRoyaltyRecipients
            );
            
            // Distribute royalties to all recipients
            royalty_fee = royalty_config.distribute_royalties(
                &ctx.accounts.buyer.to_account_info(),
                recipient_accounts,
                &ctx.accounts.system_program,
                price,
                &[]
            )?;
        } else {
            return Err(MarketplaceError::InvalidRoyaltyRecipients.into());
        }
    } else {
        // Use legacy royalty distribution to a single recipient
        royalty_fee = listing.calculate_royalty_fee(price)?;
        
        if royalty_fee > 0 {
            let royalty_accounts = anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.royalty_recipient.to_account_info(),
            };
            let royalty_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                royalty_accounts,
            );
            anchor_lang::system_program::transfer(royalty_ctx, royalty_fee)?;
        }
    }
    
    // 3. Calculate and transfer seller proceeds
    let seller_proceeds = price
        .checked_sub(marketplace_fee)
        .unwrap()
        .checked_sub(royalty_fee)
        .unwrap();
    
    let seller_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.buyer.to_account_info(),
        to: ctx.accounts.seller.to_account_info(),
    };
    let seller_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        seller_accounts,
    );
    anchor_lang::system_program::transfer(seller_ctx, seller_proceeds)?;
    
    // Transfer the NFT from escrow to buyer
    let pda_seeds = &[
        b"listing",
        listing.ticket_mint.as_ref(),
        &[listing.bump],
    ];
    let signer = &[&pda_seeds[..]];
    
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
        authority: ctx.accounts.listing.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, 1)?;
    
    // Update the listing state
    listing.state = ListingState::Sold;
    
    Ok(())
}_fee)
        .unwrap()
        .checked_sub(royalty_fee)
        .unwrap();
    
    // Transfer SOL from buyer to marketplace, royalty recipient, and seller
    // 1. Marketplace fee
    if marketplace_fee > 0 {
        let marketplace_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.marketplace_authority.to_account_info(),
        };
        let marketplace_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            marketplace_accounts,
        );
        anchor_lang::system_program::transfer(marketplace_ctx, marketplace_fee)?;
    }
    
    // 2. Royalty fee
    if royalty_fee > 0 {
        let royalty_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.royalty_recipient.to_account_info(),
        };
        let royalty_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            royalty_accounts,
        );
        anchor_lang::system_program::transfer(royalty_ctx, royalty_fee)?;
    }
    
    // 3. Seller proceeds
    let seller_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.buyer.to_account_info(),
        to: ctx.accounts.seller.to_account_info(),
    };
    let seller_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        seller_accounts,
    );
    anchor_lang::system_program::transfer(seller_ctx, seller_proceeds)?;
    
    // Transfer the NFT from escrow to buyer
    let pda_seeds = &[
        b"listing",
        listing.ticket_mint.as_ref(),
        &[listing.bump],
    ];
    let signer = &[&pda_seeds[..]];
    
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
        authority: ctx.accounts.listing.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, 1)?;
    
    // Update the listing state
    listing.state = ListingState::Sold;
    
    Ok(())
}
