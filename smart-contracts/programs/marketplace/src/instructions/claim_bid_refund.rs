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
