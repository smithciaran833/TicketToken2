use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::{system_instruction, program::invoke_signed};
use crate::{state::*, errors::*};

#[derive(Accounts)]
pub struct EndAuction<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    
    /// The marketplace configuration
    #[account(
        mut,
        seeds = [b"marketplace_config"],
        bump = marketplace_config.bump
    )]
    pub marketplace_config: Account<'info, MarketplaceConfig>,
    
    /// The auction listing
    #[account(
        mut,
        seeds = [b"listing", mint.key().as_ref()],
        bump = listing.bump,
        constraint = listing.is_active @ MarketplaceError::ListingNotActive,
        constraint = listing.listing_type == ListingType::Auction @ MarketplaceError::NotAuctionListing
    )]
    pub listing: Account<'info, Listing>,
    
    /// Escrow token account holding NFT
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    
    /// Winner's token account
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = winner,
    )]
    pub winner_token_account: Account<'info, TokenAccount>,
    
    /// Winning bid account
    #[account(
        mut,
        seeds = [b"bid", listing.key().as_ref(), winner.key().as_ref()],
        bump = winning_bid.bump
    )]
    pub winning_bid: Account<'info, Bid>,
    
    /// Bid escrow holding winning bid funds
    #[account(
        mut,
        seeds = [b"bid_escrow", winning_bid.key().as_ref()],
        bump
    )]
    /// CHECK: PDA holding winning bid funds
    pub bid_escrow: UncheckedAccount<'info>,
    
    /// The NFT mint
    pub mint: Account<'info, Mint>,
    
    /// Winner of auction
    /// CHECK: Winner account
    pub winner: UncheckedAccount<'info>,
    
    /// Seller receiving payment
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: UncheckedAccount<'info>,
    
    /// Platform fee recipient
    #[account(mut)]
    /// CHECK: Fee recipient
    pub fee_recipient: UncheckedAccount<'info>,
    
    /// Royalty recipient
    #[account(mut)]
    /// CHECK: Royalty recipient
    pub royalty_recipient: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EndAuction>) -> Result<()> {
    let listing = &ctx.accounts.listing;
    let clock = Clock::get()?;
    
    // Check if auction has ended
    if let Some(ref auction_config) = listing.auction_config {
        require!(
            clock.unix_timestamp >= auction_config.end_time,
            MarketplaceError::AuctionStillActive
        );
    }

    let winning_bid = &ctx.accounts.winning_bid;
    require!(winning_bid.is_active, MarketplaceError::NoBidsPlaced);

    let price = winning_bid.amount;
    let platform_fee_bps = ctx.accounts.marketplace_config.platform_fee_bps;
    
    // Calculate fees (same calculation logic as buy_ticket)
    let platform_fee = (price as u128)
        .checked_mul(platform_fee_bps as u128)
        .ok_or(MarketplaceError::MathOverflow)?
        .checked_div(10000)
        .ok_or(MarketplaceError::MathOverflow)? as u64;

    let mut royalty_fee = 0u64;
    if let Some(ref royalty_config) = listing.royalty_config {
        royalty_fee = (price as u128)
            .checked_mul(royalty_config.percentage_bps as u128)
            .ok_or(MarketplaceError::MathOverflow)?
            .checked_div(10000)
            .ok_or(MarketplaceError::MathOverflow)? as u64;
    }

    let seller_proceeds = price
        .checked_sub(platform_fee)
        .ok_or(MarketplaceError::MathOverflow)?
        .checked_sub(royalty_fee)
        .ok_or(MarketplaceError::MathOverflow)?;

    // Transfer NFT to winner
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
            to: ctx.accounts.winner_token_account.to_account_info(),
            authority: listing.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, 1)?;

    // Transfer funds from bid escrow
    let bid_escrow_seeds = &[
        b"bid_escrow",
        winning_bid.key().as_ref(),
        &[*ctx.bumps.get("bid_escrow").unwrap()],
    ];
    let bid_signer_seeds = &[&bid_escrow_seeds[..]];

    // Payments to seller, platform, and royalty recipient
    if seller_proceeds > 0 {
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.bid_escrow.key(),
                &ctx.accounts.seller.key(),
                seller_proceeds,
            ),
            &[
                ctx.accounts.bid_escrow.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            bid_signer_seeds,
        )?;
    }

    if platform_fee > 0 {
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.bid_escrow.key(),
                &ctx.accounts.fee_recipient.key(),
                platform_fee,
            ),
            &[
                ctx.accounts.bid_escrow.to_account_info(),
                ctx.accounts.fee_recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            bid_signer_seeds,
        )?;
    }

    if royalty_fee > 0 {
        invoke_signed(
            &system_instruction::transfer(
                &ctx.accounts.bid_escrow.key(),
                &ctx.accounts.royalty_recipient.key(),
                royalty_fee,
            ),
            &[
                ctx.accounts.bid_escrow.to_account_info(),
                ctx.accounts.royalty_recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            bid_signer_seeds,
        )?;
    }

    // Update marketplace stats
    let marketplace_config = &mut ctx.accounts.marketplace_config;
    marketplace_config.total_volume = marketplace_config.total_volume
        .checked_add(price)
        .ok_or(MarketplaceError::MathOverflow)?;
    marketplace_config.total_fees_collected = marketplace_config.total_fees_collected
        .checked_add(platform_fee)
        .ok_or(MarketplaceError::MathOverflow)?;

    // Mark listing and bid as inactive
    let listing = &mut ctx.accounts.listing;
    listing.is_active = false;
    
    let winning_bid = &mut ctx.accounts.winning_bid;
    winning_bid.is_active = false;

    emit!(AuctionEnded {
        listing: listing.key(),
        winner: ctx.accounts.winner.key(),
        winning_bid: price,
    });

    emit!(ItemSold {
        listing: listing.key(),
        buyer: ctx.accounts.winner.key(),
        seller: ctx.accounts.seller.key(),
        mint: ctx.accounts.mint.key(),
        price,
        platform_fee,
        royalty_fee,
    });

    Ok(())
}
