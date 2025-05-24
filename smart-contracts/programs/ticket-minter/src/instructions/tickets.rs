use anchor_lang::prelude::*;
use anchor_spl::token;
use crate::{Ticket, TicketStatus, TicketError, Event};

/// Updates a ticket's status
pub fn update_ticket_status(
    ctx: Context<crate::UpdateTicketStatus>,
    new_status: TicketStatus,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let current_time = Clock::get()?.unix_timestamp;
    
    // Check if ticket is valid for status update
    if ticket.status == TicketStatus::Revoked {
        return err!(TicketError::InvalidTicket);
    }
    
    // Cannot change status from Used to Valid
    if ticket.status == TicketStatus::Used && new_status == TicketStatus::Valid {
        return err!(TicketError::InvalidStatus);
    }
    
    // Check if ticket belongs to the correct event
    if ticket.event != ctx.accounts.event.key() {
        return err!(TicketError::TicketEventMismatch);
    }
    
    // Update status
    let old_status = ticket.status;
    ticket.status = new_status;
    
    // If status is now Used, update the used_at timestamp
    if new_status == TicketStatus::Used && ticket.used_at.is_none() {
        ticket.used_at = Some(current_time);
    }
    
    msg!(
        "Updated ticket {} status from {:?} to {:?}",
        ticket.serial_number,
        old_status,
        new_status
    );
    
    Ok(())
}

/// Transfers a ticket to a new owner
pub fn transfer_ticket(
    ctx: Context<crate::TransferTicket>,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    
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
        authority: ctx.accounts.from.to_account_info(),
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
    ticket.owner = ctx.accounts.to.key();
    
    msg!(
        "Transferred ticket #{} from {} to {}",
        ticket.serial_number,
        previous_owner,
        ctx.accounts.to.key()
    );
    
    Ok(())
}

/// Revokes a ticket
pub fn revoke_ticket(
    ctx: Context<RevokeTicket>,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    
    // Update ticket status
    let old_status = ticket.status;
    ticket.status = TicketStatus::Revoked;
    
    msg!(
        "Revoked ticket #{} for event '{}' (was {:?})",
        ticket.serial_number,
        ctx.accounts.event.name,
        old_status
    );
    
    Ok(())
}

/// Context for revoking a ticket
#[derive(Accounts)]
pub struct RevokeTicket<'info> {
    /// The event this ticket belongs to
    #[account(has_one = organizer)]
    pub event: Account<'info, Event>,
    
    /// The ticket to revoke
    #[account(
        mut,
        constraint = ticket.event == event.key(),
    )]
    pub ticket: Account<'info, Ticket>,
    
    /// The event organizer
    pub organizer: Signer<'info>,
}

/// Sets a ticket's transferability
pub fn set_ticket_transferability(
    ctx: Context<SetTicketTransferability>,
    transferable: bool,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    
    // Update transferability
    let old_transferable = ticket.transferable;
    ticket.transferable = transferable;
    
    msg!(
        "Set ticket #{} transferability from {} to {} for event '{}'",
        ticket.serial_number,
        old_transferable,
        transferable,
        ctx.accounts.event.name
    );
    
    Ok(())
}

/// Context for setting ticket transferability
#[derive(Accounts)]
pub struct SetTicketTransferability<'info> {
    /// The event this ticket belongs to
    #[account(has_one = organizer)]
    pub event: Account<'info, Event>,
    
    /// The ticket to update
    #[account(
        mut,
        constraint = ticket.event == event.key(),
    )]
    pub ticket: Account<'info, Ticket>,
    
    /// The event organizer
    pub organizer: Signer<'info>,
}

/// Batch update multiple tickets' status
pub fn batch_update_ticket_status(
    ctx: Context<BatchUpdateTicketStatus>,
    new_status: TicketStatus,
) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    let mut updated_count = 0;
    
    // Update each ticket in remaining accounts
    for account_info in ctx.remaining_accounts.iter() {
        // Try to deserialize as Ticket account
        if let Ok(mut ticket) = Account::<Ticket>::try_from(account_info) {
            // Verify ticket belongs to the event
            if ticket.event != ctx.accounts.event.key() {
                continue; // Skip tickets not for this event
            }
            
            // Skip invalid tickets
            if ticket.status == TicketStatus::Revoked {
                continue;
            }
            
            // Cannot change from Used to Valid
            if ticket.status == TicketStatus::Used && new_status == TicketStatus::Valid {
                continue;
            }
            
            // Update status
            ticket.status = new_status;
            
            // If marking as used, set timestamp
            if new_status == TicketStatus::Used && ticket.used_at.is_none() {
                ticket.used_at = Some(current_time);
            }
            
            // Save the ticket account
            ticket.exit(ctx.program_id)?;
            updated_count += 1;
        }
    }
    
    msg!(
        "Batch updated {} tickets to status {:?} for event '{}'",
        updated_count,
        new_status,
        ctx.accounts.event.name
    );
    
    Ok(())
}

/// Context for batch updating ticket status
#[derive(Accounts)]
pub struct BatchUpdateTicketStatus<'info> {
    /// The event these tickets belong to
    #[account(constraint = event.is_validator(validator.key()))]
    pub event: Account<'info, Event>,
    
    /// The validator performing the update
    pub validator: Signer<'info>,
    
    // Ticket accounts are passed as remaining_accounts
}
