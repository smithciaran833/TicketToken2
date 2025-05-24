//! Transfer instruction handlers
//!
//! This module contains handlers for ticket transfer-related instructions.

use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::associated_token::{self, AssociatedToken};
use solana_program::program::invoke_signed;
use solana_program::system_instruction;
use crate::{Ticket, TicketStatus, TicketError, Event, TransferRecord};

/// Transfers a ticket to a new owner
pub fn transfer_ticket(
    ctx: Context<crate::TransferTicket>,
) -> Result<()> {
    // Get accounts
    let ticket = &mut ctx.accounts.ticket;
    let from = &ctx.accounts.from;
    let to = ctx.accounts.to.key();
    
    // Check if ticket is transferable
    if !ticket.transferable {
        return err!(TicketError::NotTransferable);
    }
    
    // Only valid tickets can be transferred
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Transfer the token
    let transfer_ix = token::Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: from.to_account_info(),
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
    ticket.owner = to;
    
    // Record transfer in history if available
    if let Some(transfer_record) = &mut ctx.accounts.transfer_record {
        transfer_record.history.push(TransferDetail {
            from: previous_owner,
            to,
            price: ctx.accounts.payment_amount,
            timestamp: Clock::get()?.unix_timestamp,
            transfer_type: if ctx.accounts.payment_amount > 0 {
                TransferType::Sale
            } else {
                TransferType::Gift
            }
        });
    }
    
    // Process payment if this is a sale
    if ctx.accounts.payment_amount > 0 && ctx.accounts.payment_token_account.is_some() {
        let payment_amount = ctx.accounts.payment_amount;
        let payment_from = ctx.accounts.payment_from_account.as_ref().unwrap();
        let payment_to = ctx.accounts.payment_to_account.as_ref().unwrap();
        
        // Transfer payment
        let payment_ix = token::Transfer {
            from: payment_from.to_account_info(),
            to: payment_to.to_account_info(),
            authority: from.to_account_info(),
        };
        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                payment_ix,
            ),
            payment_amount,
        )?;
        
        // If royalties are configured, transfer royalties
        if let Some(event) = &ctx.accounts.event {
            if event.royalty_basis_points > 0 && ctx.accounts.royalty_account.is_some() {
                // Calculate royalty amount
                let royalty_amount = (payment_amount as u128)
                    .checked_mul(event.royalty_basis_points as u128)
                    .unwrap_or(0)
                    .checked_div(10000)
                    .unwrap_or(0) as u64;
                
                if royalty_amount > 0 {
                    // Transfer royalty
                    let royalty_ix = token::Transfer {
                        from: payment_from.to_account_info(),
                        to: ctx.accounts.royalty_account.as_ref().unwrap().to_account_info(),
                        authority: from.to_account_info(),
                    };
                    
                    token::transfer(
                        CpiContext::new(
                            ctx.accounts.token_program.to_account_info(),
                            royalty_ix,
                        ),
                        royalty_amount,
                    )?;
                }
            }
        }
    }
    
    // Emit transfer event
    emit!(TicketTransferEvent {
        ticket: ticket.key(),
        from: previous_owner,
        to,
        price: ctx.accounts.payment_amount,
    });
    
    msg!("Transferred ticket from {} to {}", previous_owner, to);
    Ok(())
}

/// Creates a new transfer listing
pub fn create_transfer_listing(
    ctx: Context<CreateTransferListing>,
    price: u64,
    allow_direct_transfer: bool,
) -> Result<()> {
    // Get accounts
    let ticket = &ctx.accounts.ticket;
    let listing = &mut ctx.accounts.listing;
    
    // Check if ticket is transferable
    if !ticket.transferable {
        return err!(TicketError::NotTransferable);
    }
    
    // Only valid tickets can be listed
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Initialize listing
    listing.ticket = ticket.key();
    listing.owner = ctx.accounts.owner.key();
    listing.event = ticket.event;
    listing.price = price;
    listing.allow_direct_transfer = allow_direct_transfer;
    listing.created_at = Clock::get()?.unix_timestamp;
    listing.expiry = None; // No expiry by default
    listing.active = true;
    listing.bump = *ctx.bumps.get("listing").unwrap();
    
    // Emit listing created event
    emit!(TransferListingCreatedEvent {
        listing: listing.key(),
        ticket: ticket.key(),
        owner: ctx.accounts.owner.key(),
        price,
    });
    
    msg!("Created transfer listing for ticket: {}", ticket.key());
    Ok(())
}

/// Cancels a transfer listing
pub fn cancel_transfer_listing(
    ctx: Context<CancelTransferListing>,
) -> Result<()> {
    // Get listing
    let listing = &mut ctx.accounts.listing;
    
    // Mark listing as inactive
    listing.active = false;
    
    // Emit listing cancelled event
    emit!(TransferListingCancelledEvent {
        listing: listing.key(),
        ticket: ctx.accounts.ticket.key(),
        owner: ctx.accounts.owner.key(),
    });
    
    msg!("Cancelled transfer listing for ticket: {}", ctx.accounts.ticket.key());
    Ok(())
}

/// Accepts a transfer listing (purchase)
pub fn accept_transfer_listing(
    ctx: Context<AcceptTransferListing>,
) -> Result<()> {
    // Get accounts
    let listing = &ctx.accounts.listing;
    let ticket = &mut ctx.accounts.ticket;
    
    // Check if listing is active
    if !listing.active {
        return err!(TicketError::ListingInactive);
    }
    
    // Check if ticket is still valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Check if listing owner still owns the ticket
    if ticket.owner != listing.owner {
        return err!(TicketError::TicketOwnerChanged);
    }
    
    // Check if listing has expired
    if let Some(expiry) = listing.expiry {
        let current_time = Clock::get()?.unix_timestamp;
        if current_time > expiry {
            return err!(TicketError::ListingExpired);
        }
    }
    
    // Transfer the token
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
    
    // Record transfer in history if available
    if let Some(transfer_record) = &mut ctx.accounts.transfer_record {
        transfer_record.history.push(TransferDetail {
            from: previous_owner,
            to: ctx.accounts.buyer.key(),
            price: listing.price,
            timestamp: Clock::get()?.unix_timestamp,
            transfer_type: TransferType::Sale
        });
    }
    
    // Process payment
    if listing.price > 0 {
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
            listing.price,
        )?;
        
        // If royalties are configured, transfer royalties
        if let Some(event) = &ctx.accounts.event {
            if event.royalty_basis_points > 0 && ctx.accounts.royalty_account.is_some() {
                // Calculate royalty amount
                let royalty_amount = (listing.price as u128)
                    .checked_mul(event.royalty_basis_points as u128)
                    .unwrap_or(0)
                    .checked_div(10000)
                    .unwrap_or(0) as u64;
                
                if royalty_amount > 0 {
                    // Transfer royalty
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
            }
        }
    }
    
    // Mark listing as inactive
    let listing_mut = &mut ctx.accounts.listing;
    listing_mut.active = false;
    
    // Emit transfer event
    emit!(TicketTransferEvent {
        ticket: ticket.key(),
        from: previous_owner,
        to: ctx.accounts.buyer.key(),
        price: listing.price,
    });
    
    msg!("Accepted transfer listing, transferred ticket from {} to {}", previous_owner, ctx.accounts.buyer.key());
    Ok(())
}

/// Sets a ticket's transferability
pub fn set_ticket_transferability(
    ctx: Context<SetTicketTransferability>,
    transferable: bool,
) -> Result<()> {
    // Get ticket
    let ticket = &mut ctx.accounts.ticket;
    
    // Update transferability
    ticket.transferable = transferable;
    
    // Emit event
    emit!(TicketTransferabilityEvent {
        ticket: ticket.key(),
        transferable,
    });
    
    msg!("Set ticket transferability to {}", transferable);
    Ok(())
}

/// Context for creating a transfer listing
#[derive(Accounts)]
pub struct CreateTransferListing<'info> {
    /// The ticket to list
    #[account(constraint = ticket.owner == owner.key())]
    pub ticket: Account<'info, Ticket>,
    
    /// The listing account
    #[account(
        init,
        payer = owner,
        space = TransferListing::SPACE,
        seeds = [b"transfer_listing", ticket.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, TransferListing>,
    
    /// The owner of the ticket
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
}

/// Context for cancelling a transfer listing
#[derive(Accounts)]
pub struct CancelTransferListing<'info> {
    /// The ticket that was listed
    #[account(constraint = ticket.owner == owner.key())]
    pub ticket: Account<'info, Ticket>,
    
    /// The listing to cancel
    #[account(
        mut,
        constraint = listing.ticket == ticket.key(),
        constraint = listing.owner == owner.key(),
        seeds = [b"transfer_listing", ticket.key().as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, TransferListing>,
    
    /// The owner of the ticket
    pub owner: Signer<'info>,
}

/// Context for accepting a transfer listing
#[derive(Accounts)]
pub struct AcceptTransferListing<'info> {
    /// The ticket being purchased
    #[account(
        mut,
        constraint = ticket.key() == listing.ticket,
        constraint = ticket.owner == listing.owner
    )]
    pub ticket: Account<'info, Ticket>,
    
    /// The listing being accepted
    #[account(
        mut,
        seeds = [b"transfer_listing", ticket.key().as_ref()],
        bump = listing.bump
    )]
    pub listing: Account<'info, TransferListing>,
    
    /// The mint of the ticket NFT
    pub mint: Account<'info, anchor_spl::token::Mint>,
    
    /// The seller's token account
    #[account(
        mut,
        constraint = from_token_account.owner == seller.key(),
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// The buyer's token account
    #[account(
        mut,
        constraint = to_token_account.owner == buyer.key(),
        constraint = to_token_account.mint == mint.key()
    )]
    pub to_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// The seller of the ticket
    #[account(constraint = seller.key() == listing.owner)]
    pub seller: Signer<'info>,
    
    /// The buyer of the ticket
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// Payment from account (buyer)
    #[account(
        mut,
        constraint = payment_from_account.owner == buyer.key()
    )]
    pub payment_from_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Payment to account (seller)
    #[account(
        mut,
        constraint = payment_to_account.owner == seller.key()
    )]
    pub payment_to_account: Account<'info, anchor_spl::token::TokenAccount>,
    
    /// Optional royalty account
    #[account(mut)]
    pub royalty_account: Option<Account<'info, anchor_spl::token::TokenAccount>>,
    
    /// Optional event account
    pub event: Option<Account<'info, Event>>,
    
    /// Optional transfer record account
    #[account(mut)]
    pub transfer_record: Option<Account<'info, TransferRecord>>,
    
    /// Token program
    pub token_program: Program<'info, anchor_spl::token::Token>,
    
    /// Associated token program
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Context for setting ticket transferability
#[derive(Accounts)]
pub struct SetTicketTransferability<'info> {
    /// The event the ticket belongs to
    #[account(has_one = organizer)]
    pub event: Account<'info, Event>,
    
    /// The ticket to update
    #[account(
        mut,
        constraint = ticket.event == event.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    /// The event organizer
    pub organizer: Signer<'info>,
}

/// Transfer listing account
#[account]
pub struct TransferListing {
    /// The ticket being listed
    pub ticket: Pubkey,
    
    /// The owner of the ticket
    pub owner: Pubkey,
    
    /// The event the ticket is for
    pub event: Pubkey,
    
    /// The price in tokens
    pub price: u64,
    
    /// Whether direct transfers are allowed
    pub allow_direct_transfer: bool,
    
    /// When the listing was created
    pub created_at: i64,
    
    /// Optional expiry time
    pub expiry: Option<i64>,
    
    /// Whether the listing is active
    pub active: bool,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl TransferListing {
    /// Space needed for the transfer listing account
    pub const SPACE: usize = 8 + // discriminator
        32 + // ticket
        32 + // owner
        32 + // event
        8 + // price
        1 + // allow_direct_transfer
        8 + // created_at
        9 + // expiry (Option<i64>)
        1 + // active
        1 + // bump
        50; // padding
}

/// Transfer record account to store transfer history
#[account]
pub struct TransferRecord {
    /// The ticket this record is for
    pub ticket: Pubkey,
    
    /// History of transfers
    pub history: Vec<TransferDetail>,
    
    /// Bump seed for PDA derivation
    pub bump: u8,
}

/// Details of a single transfer
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransferDetail {
    /// Previous owner
    pub from: Pubkey,
    
    /// New owner
    pub to: Pubkey,
    
    /// Price paid (if any)
    pub price: u64,
    
    /// When the transfer occurred
    pub timestamp: i64,
    
    /// Type of transfer
    pub transfer_type: TransferType,
}

/// Type of transfer
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TransferType {
    /// Initial mint
    Mint,
    
    /// Gift (no payment)
    Gift,
    
    /// Sale (with payment)
    Sale,
    
    /// Distribution (from organizer)
    Distribution,
}

impl TransferRecord {
    /// Maximum number of transfers to store
    pub const MAX_HISTORY: usize = 10;
    
    /// Space needed for the transfer record account
    pub fn space(max_history: usize) -> usize {
        8 + // discriminator
        32 + // ticket
        4 + (max_history * (32 + 32 + 8 + 8 + 1)) + // history vector with TransferDetail struct
        1 + // bump
        50 // padding
    }
}

/// Event emitted when a ticket is transferred
#[event]
pub struct TicketTransferEvent {
    /// The ticket that was transferred
    #[index]
    pub ticket: Pubkey,
    
    /// From address
    pub from: Pubkey,
    
    /// To address
    pub to: Pubkey,
    
    /// Price paid (if any)
    pub price: u64,
}

/// Event emitted when a transfer listing is created
#[event]
pub struct TransferListingCreatedEvent {
    /// The listing that was created
    #[index]
    pub listing: Pubkey,
    
    /// The ticket being listed
    pub ticket: Pubkey,
    
    /// The owner of the ticket
    pub owner: Pubkey,
    
    /// The price
    pub price: u64,
}

/// Event emitted when a transfer listing is cancelled
#[event]
pub struct TransferListingCancelledEvent {
    /// The listing that was cancelled
    #[index]
    pub listing: Pubkey,
    
    /// The ticket that was listed
    pub ticket: Pubkey,
    
    /// The owner of the ticket
    pub owner: Pubkey,
}

/// Event emitted when a ticket's transferability changes
#[event]
pub struct TicketTransferabilityEvent {
    /// The ticket that was updated
    #[index]
    pub ticket: Pubkey,
    
    /// New transferability setting
    pub transferable: bool,
}
