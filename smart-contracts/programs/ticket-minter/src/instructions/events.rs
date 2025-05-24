//! Event instruction handlers
//!
//! This module contains handlers for event-related instructions.

use anchor_lang::prelude::*;
use crate::{Event, TicketError};

/// Creates a new event
pub fn create_event(
    ctx: Context<crate::CreateEvent>,
    event_id: String,
    name: String,
    symbol: String,
    description: String,
    venue: String,
    start_date: i64,
    end_date: i64,
    max_tickets: u32,
    royalty_basis_points: u16,
) -> Result<()> {
    // Validate inputs
    if start_date >= end_date {
        return err!(TicketError::InvalidEventDates);
    }

    if royalty_basis_points > 10000 {
        return err!(TicketError::InvalidAttribute);
    }

    let event = &mut ctx.accounts.event;
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Initialize event account
    event.event_id = event_id;
    event.name = name;
    event.symbol = symbol;
    event.description = description;
    event.venue = venue;
    event.start_date = start_date;
    event.end_date = end_date;
    event.organizer = ctx.accounts.organizer.key();
    event.max_tickets = max_tickets;
    event.tickets_issued = 0;
    event.royalty_basis_points = royalty_basis_points;
    event.validators = Vec::new();
    event.active = true;
    event.bump = *ctx.bumps.get("event").unwrap();

    msg!("Created new event: {}", event.name);
    Ok(())
}

/// Updates an event's details
pub fn update_event(
    ctx: Context<crate::UpdateEvent>,
    name: Option<String>,
    description: Option<String>,
    venue: Option<String>,
    start_date: Option<i64>,
    end_date: Option<i64>,
) -> Result<()> {
    let event = &mut ctx.accounts.event;

    // Update fields if provided
    if let Some(name) = name {
        event.name = name;
    }

    if let Some(description) = description {
        event.description = description;
    }

    if let Some(venue) = venue {
        event.venue = venue;
    }

    // Handle date updates
    let new_start = start_date.unwrap_or(event.start_date);
    let new_end = end_date.unwrap_or(event.end_date);

    // Validate dates
    if new_start >= new_end {
        return err!(TicketError::InvalidEventDates);
    }

    event.start_date = new_start;
    event.end_date = new_end;

    msg!("Updated event: {}", event.name);
    Ok(())
}

/// Adds a validator to an event
pub fn add_validator(
    ctx: Context<crate::AddValidator>,
    validator: Pubkey,
) -> Result<()> {
    let event = &mut ctx.accounts.event;

    // Check if validator already exists
    if event.validators.contains(&validator) {
        return err!(TicketError::ValidatorAlreadyExists);
    }

    // Limit validators to prevent excessive account size
    if event.validators.len() >= 10 {
        return err!(TicketError::MaxValidatorsExceeded);
    }

    // Add validator
    event.validators.push(validator);

    msg!("Added validator {} to event {}", validator, event.name);
    Ok(())
}

/// Removes a validator from an event
pub fn remove_validator(
    ctx: Context<crate::RemoveValidator>,
    validator: Pubkey,
) -> Result<()> {
    let event = &mut ctx.accounts.event;

    // Find validator index
    let validator_position = event.validators.iter().position(|&v| v == validator);

    // Check if validator exists
    if validator_position.is_none() {
        return err!(TicketError::ValidatorNotFound);
    }

    // Remove validator
    event.validators.remove(validator_position.unwrap());

    msg!("Removed validator {} from event {}", validator, event.name);
    Ok(())
}
