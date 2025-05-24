//! Ownership verification functions
//!
//! This module contains functions for verifying ticket ownership
//! and performing ownership-based validations.

use anchor_lang::prelude::*;
use crate::{Ticket, TicketStatus, TicketError};

/// Verifies a ticket for entry to an event
pub fn verify_ticket_for_entry(
    ctx: Context<VerifyTicketForEntry>,
) -> Result<()> {
    let ticket = &ctx.accounts.ticket;
    
    // First, check ticket status - must be Valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Check if the event has ended
    let event = &ctx.accounts.event;
    let current_time = Clock::get()?.unix_timestamp;
    if current_time > event.end_date {
        return err!(TicketError::EventEnded);
    }
    
    // Check if the event has started
    if current_time < event.start_date {
        return err!(TicketError::EventNotStarted);
    }
    
    // Check if ticket belongs to the provided owner
    if ticket.owner != ctx.accounts.ticket_owner.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Additional verification logic can be added here
    // (e.g., checking for specific ticket attributes)
    
    msg!("Ticket verification successful for event: {}", event.name);
    
    // Note: At this point, the ticket has been verified but its status
    // hasn't changed. You might want to call update_ticket_status after this
    // to mark it as Used.
    
    Ok(())
}

/// Verifies a ticket and marks it as used in a single transaction
pub fn verify_and_mark_used(
    ctx: Context<VerifyTicketForEntry>,
) -> Result<()> {
    // First verify the ticket is valid for entry
    verify_ticket_for_entry(ctx.reborrow())?;
    
    // Then mark it as used
    let ticket = &mut ctx.accounts.ticket;
    ticket.status = TicketStatus::Used;
    ticket.used_at = Some(Clock::get()?.unix_timestamp);
    
    msg!("Ticket verified and marked as used");
    Ok(())
}

/// Checks if a user owns a ticket for an event (for access control)
pub fn verify_user_has_ticket_for_event(
    ctx: Context<VerifyEventAccess>,
) -> Result<()> {
    // Check if ticket belongs to the provided owner
    if ctx.accounts.ticket.owner != ctx.accounts.user.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Check if ticket is for the specified event
    if ctx.accounts.ticket.event != ctx.accounts.event.key() {
        return err!(TicketError::TicketEventMismatch);
    }
    
    // Check if ticket is valid (not revoked or expired)
    if ctx.accounts.ticket.status != TicketStatus::Valid && 
       ctx.accounts.ticket.status != TicketStatus::Used {
        return err!(TicketError::InvalidTicket);
    }
    
    msg!("User verified as ticket holder for event: {}", ctx.accounts.event.name);
    Ok(())
}

/// Context for verifying a ticket for entry
#[derive(Accounts)]
pub struct VerifyTicketForEntry<'info> {
    /// The event the ticket is for
    pub event: Account<'info, crate::Event>,
    
    /// The ticket to verify
    pub ticket: Account<'info, Ticket>,
    
    /// The owner of the ticket
    pub ticket_owner: Signer<'info>,
    
    /// The validator performing the verification
    #[account(constraint = event.is_validator(validator.key()))]
    pub validator: Signer<'info>,
}

/// Context for verifying a user has a ticket for an event
#[derive(Accounts)]
pub struct VerifyEventAccess<'info> {
    /// The event to check access for
    pub event: Account<'info, crate::Event>,
    
    /// The ticket to check
    #[account(constraint = ticket.event == event.key())]
    pub ticket: Account<'info, Ticket>,
    
    /// The user to verify
    pub user: Signer<'info>,
}

/// Verifies the ownership of multiple tickets for the same user
pub fn verify_multiple_tickets(
    ctx: Context<VerifyMultipleTickets>,
    ticket_mints: Vec<Pubkey>,
) -> Result<()> {
    let user = &ctx.accounts.user;
    
    // Verify each ticket
    for mint in ticket_mints {
        // Find ticket PDA
        let (ticket_pda, _) = Pubkey::find_program_address(
            &[b"ticket", mint.as_ref()],
            ctx.program_id,
        );
        
        // Fetch ticket account
        let ticket = Ticket::try_from_account_info(&ctx.remaining_accounts[0])?;
        
        // Verify ticket mint matches
        if ticket.mint != mint {
            return err!(TicketError::TicketMintMismatch);
        }
        
        // Verify ticket belongs to user
        if ticket.owner != user.key() {
            return err!(TicketError::TicketOwnerMismatch);
        }
        
        // Verify ticket is valid
        if ticket.status != TicketStatus::Valid {
            return err!(TicketError::InvalidTicket);
        }
    }
    
    msg!("All tickets verified successfully");
    Ok(())
}

/// Context for verifying multiple tickets
#[derive(Accounts)]
pub struct VerifyMultipleTickets<'info> {
    /// The user who should own all tickets
    pub user: Signer<'info>,
    
    /// The remaining accounts will be the ticket accounts
    /// They need to be passed in the same order as the mint addresses
}

/// Generates a verification challenge for off-chain verification
pub fn generate_verification_challenge(
    ctx: Context<GenerateChallenge>,
) -> Result<()> {
    let ticket = &ctx.accounts.ticket;
    
    // Verify ticket belongs to the provided owner
    if ticket.owner != ctx.accounts.ticket_owner.key() {
        return err!(TicketError::TicketOwnerMismatch);
    }
    
    // Verify ticket is valid
    if ticket.status != TicketStatus::Valid {
        return err!(TicketError::InvalidTicket);
    }
    
    // Generate challenge data
    let event = &ctx.accounts.event;
    let current_time = Clock::get()?.unix_timestamp;
    let challenge_data = format!(
        "TicketToken Verification Challenge\n\
        Event: {}\n\
        Ticket: {}\n\
        Owner: {}\n\
        Timestamp: {}\n\
        Nonce: {}", 
        event.name,
        ticket.mint.to_string(),
        ticket.owner.to_string(),
        current_time,
        ctx.accounts.verification_account.nonce
    );
    
    // Store challenge data and timestamp in the verification account
    let verification = &mut ctx.accounts.verification_account;
    verification.challenge_data = challenge_data;
    verification.timestamp = current_time;
    verification.ticket = ticket.key();
    verification.event = event.key();
    verification.owner = ticket.owner;
    verification.expiration = current_time + 300; // 5 minutes expiration
    
    msg!("Generated verification challenge");
    Ok(())
}

/// Verification challenge account
#[account]
pub struct VerificationChallenge {
    /// Challenge data to be signed
    pub challenge_data: String,
    /// Timestamp when challenge was generated
    pub timestamp: i64,
    /// Ticket being verified
    pub ticket: Pubkey,
    /// Event the ticket is for
    pub event: Pubkey,
    /// Owner of the ticket
    pub owner: Pubkey,
    /// Expiration timestamp
    pub expiration: i64,
    /// Random nonce for this challenge
    pub nonce: u64,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl VerificationChallenge {
    /// Space needed for verification challenge account
    pub const SPACE: usize = 8 + // discriminator
        4 + 256 + // challenge_data (String)
        8 + // timestamp
        32 + // ticket
        32 + // event
        32 + // owner
        8 + // expiration
        8 + // nonce
        1 + // bump
        50; // padding
}

/// Context for generating a verification challenge
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct GenerateChallenge<'info> {
    /// The event the ticket is for
    pub event: Account<'info, crate::Event>,
    
    /// The ticket to verify
    #[account(constraint = ticket.event == event.key())]
    pub ticket: Account<'info, Ticket>,
    
    /// The owner of the ticket
    pub ticket_owner: Signer<'info>,
    
    /// The validator generating the challenge
    #[account(constraint = event.is_validator(validator.key()))]
    pub validator: Signer<'info>,
    
    /// The verification challenge account
    #[account(
        init,
        payer = validator,
        space = VerificationChallenge::SPACE,
        seeds = [b"verification", ticket.mint.as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub verification_account: Account<'info, VerificationChallenge>,
    
    /// System program
    pub system_program: Program<'info, System>,
}
