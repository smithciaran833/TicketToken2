use anchor_lang::prelude::*;
use crate::{Event, TicketType, TicketAttribute, TicketError};

/// Creates a new ticket type for an event
pub fn create_ticket_type(
    ctx: Context<crate::CreateTicketType>,
    ticket_type_id: String,
    name: String,
    description: String,
    price: u64,
    quantity: u32,
    attributes: Vec<TicketAttribute>,
) -> Result<()> {
    let event = &ctx.accounts.event;
    let ticket_type = &mut ctx.accounts.ticket_type;
    
    // Check if the event is active
    if !event.active {
        return err!(TicketError::EventInactive);
    }
    
    // Validate inputs
    if quantity == 0 {
        return err!(TicketError::InvalidAttribute);
    }
    
    if name.len() > 100 {
        return err!(TicketError::InvalidAttribute);
    }
    
    if description.len() > 500 {
        return err!(TicketError::InvalidAttribute);
    }
    
    // Initialize ticket type
    ticket_type.event = event.key();
    ticket_type.ticket_type_id = ticket_type_id;
    ticket_type.name = name.clone();
    ticket_type.description = description;
    ticket_type.price = price;
    ticket_type.quantity = quantity;
    ticket_type.sold = 0;
    ticket_type.attributes = attributes;
    ticket_type.active = true;
    ticket_type.bump = *ctx.bumps.get("ticket_type").unwrap();
    
    msg!(
        "Created ticket type '{}' for event '{}' with {} tickets at {} lamports each",
        name,
        event.name,
        quantity,
        price
    );
    
    Ok(())
}

/// Updates a ticket type
pub fn update_ticket_type(
    ctx: Context<UpdateTicketType>,
    name: Option<String>,
    description: Option<String>,
    price: Option<u64>,
    quantity: Option<u32>,
    active: Option<bool>,
) -> Result<()> {
    let ticket_type = &mut ctx.accounts.ticket_type;
    
    // Update fields if provided
    if let Some(name) = name {
        if name.len() > 100 {
            return err!(TicketError::InvalidAttribute);
        }
        ticket_type.name = name;
    }
    
    if let Some(description) = description {
        if description.len() > 500 {
            return err!(TicketError::InvalidAttribute);
        }
        ticket_type.description = description;
    }
    
    if let Some(price) = price {
        ticket_type.price = price;
    }
    
    if let Some(quantity) = quantity {
        // Can only increase quantity or set to current sold amount
        if quantity < ticket_type.sold {
            return err!(TicketError::InvalidAttribute);
        }
        ticket_type.quantity = quantity;
    }
    
    if let Some(active) = active {
        ticket_type.active = active;
    }
    
    msg!("Updated ticket type: {}", ticket_type.name);
    Ok(())
}

/// Context for updating a ticket type
#[derive(Accounts)]
pub struct UpdateTicketType<'info> {
    /// The event this ticket type belongs to
    #[account(has_one = organizer)]
    pub event: Account<'info, Event>,
    
    /// The ticket type to update
    #[account(
        mut,
        constraint = ticket_type.event == event.key()
    )]
    pub ticket_type: Account<'info, TicketType>,
    
    /// The event organizer
    pub organizer: Signer<'info>,
}

/// Sets ticket type availability
pub fn set_ticket_type_active(
    ctx: Context<SetTicketTypeActive>,
    active: bool,
) -> Result<()> {
    let ticket_type = &mut ctx.accounts.ticket_type;
    
    ticket_type.active = active;
    
    msg!(
        "Set ticket type '{}' to {}",
        ticket_type.name,
        if active { "active" } else { "inactive" }
    );
    
    Ok(())
}

/// Context for setting ticket type activity
#[derive(Accounts)]
pub struct SetTicketTypeActive<'info> {
    /// The event this ticket type belongs to
    #[account(has_one = organizer)]
    pub event: Account<'info, Event>,
    
    /// The ticket type to update
    #[account(
        mut,
        constraint = ticket_type.event == event.key()
    )]
    pub ticket_type: Account<'info, TicketType>,
    
    /// The event organizer
    pub organizer: Signer<'info>,
}
