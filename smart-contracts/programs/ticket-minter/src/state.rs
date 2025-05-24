//! Program state definitions
//!
//! This module contains the state definitions for the TicketToken program.

use anchor_lang::prelude::*;

/// Status of a ticket
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TicketStatus {
    /// Ticket is valid and can be used
    Valid,
    /// Ticket has been used for entry
    Used,
    /// Ticket has been revoked by the organizer
    Revoked,
    /// Ticket has expired (event has passed)
    Expired,
}

/// Attribute for a ticket
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct TicketAttribute {
    /// Name of the attribute
    pub trait_type: String,
    /// Value of the attribute
    pub value: String,
}

/// Event account - stores information about an event
#[account]
pub struct Event {
    /// Unique identifier for the event
    pub event_id: String,
    /// Name of the event
    pub name: String,
    /// Symbol for the event's tickets
    pub symbol: String,
    /// Description of the event
    pub description: String,
    /// Venue where the event is held
    pub venue: String,
    /// Start date of the event (Unix timestamp)
    pub start_date: i64,
    /// End date of the event (Unix timestamp)
    pub end_date: i64,
    /// Creator/organizer of the event
    pub organizer: Pubkey,
    /// Maximum number of tickets available for the event
    pub max_tickets: u32,
    /// Number of tickets currently issued
    pub tickets_issued: u32,
    /// Royalty basis points for secondary sales (e.g., 500 = 5%)
    pub royalty_basis_points: u16,
    /// List of validators that can verify/update tickets
    pub validators: Vec<Pubkey>,
    /// Is the event active
    pub active: bool,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl Event {
    /// Calculate the space needed for the event account
    pub fn space(event_id: &str) -> usize {
        8 + // discriminator
        4 + event_id.len() + // event_id
        4 + 100 + // name (estimated max length)
        4 + 10 + // symbol (estimated max length)
        4 + 500 + // description (estimated max length)
        4 + 200 + // venue (estimated max length)
        8 + // start_date
        8 + // end_date
        32 + // organizer
        4 + // max_tickets
        4 + // tickets_issued
        2 + // royalty_basis_points
        4 + (10 * 32) + // validators (estimated 10 max)
        1 + // active
        1 + // bump
        200 // padding
    }

    /// Check if a public key is a validator for this event
    pub fn is_validator(&self, key: Pubkey) -> bool {
        self.validators.contains(&key) || key == self.organizer
    }
}

/// Ticket type account - defines a type of ticket for an event
#[account]
pub struct TicketType {
    /// Reference to the event this ticket type belongs to
    pub event: Pubkey,
    /// Unique identifier for this ticket type
    pub ticket_type_id: String,
    /// Name of the ticket type (e.g., "VIP", "General Admission")
    pub name: String,
    /// Description of what this ticket type offers
    pub description: String,
    /// Price in lamports
    pub price: u64,
    /// Total number of tickets available for this type
    pub quantity: u32,
    /// Number of tickets sold for this type
    pub sold: u32,
    /// Attributes specific to this ticket type
    pub attributes: Vec<TicketAttribute>,
    /// Is this ticket type active and available for purchase
    pub active: bool,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl TicketType {
    /// Calculate the space needed for the ticket type account
    pub fn space(ticket_type_id: &str) -> usize {
        8 + // discriminator
        32 + // event
        4 + ticket_type_id.len() + // ticket_type_id
        4 + 100 + // name (estimated max length)
        4 + 500 + // description (estimated max length)
        8 + // price
        4 + // quantity
        4 + // sold
        4 + (10 * (4 + 50 + 4 + 50)) + // attributes (estimated 10 max)
        1 + // active
        1 + // bump
        200 // padding
    }
}

/// Ticket account - represents an individual NFT ticket
#[account]
pub struct Ticket {
    /// Mint account of the NFT
    pub mint: Pubkey,
    /// Event this ticket is for
    pub event: Pubkey,
    /// Ticket type of this ticket
    pub ticket_type: Pubkey,
    /// Current owner of the ticket
    pub owner: Pubkey,
    /// Serial number of the ticket for this event
    pub serial_number: u32,
    /// Metadata URI
    pub metadata_uri: String,
    /// Status of the ticket
    pub status: TicketStatus,
    /// Is the ticket transferable
    pub transferable: bool,
    /// Date when the ticket was used (if used)
    pub used_at: Option<i64>,
    /// Custom attributes for this specific ticket
    pub custom_attributes: Vec<TicketAttribute>,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl Ticket {
    /// Fixed space for a ticket account
    pub const SPACE: usize = 8 + // discriminator
        32 + // mint
        32 + // event
        32 + // ticket_type
        32 + // owner
        4 + // serial_number
        4 + 200 + // metadata_uri (estimated max length)
        1 + // status
        1 + // transferable
        9 + // used_at (Option<i64>)
        4 + (5 * (4 + 50 + 4 + 50)) + // custom_attributes (estimated 5 max)
        1 + // bump
        200; // padding
}
