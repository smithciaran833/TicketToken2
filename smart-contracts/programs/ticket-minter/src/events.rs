use anchor_lang::prelude::*;
use crate::state::{TicketStatus, TicketAttribute};

/// Event emitted when a new event is created
#[event]
pub struct EventCreated {
    #[index]
    pub event: Pubkey,
    pub organizer: Pubkey,
    pub name: String,
    pub start_date: i64,
    pub end_date: i64,
    pub max_tickets: u32,
    pub venue: String,
}

/// Event emitted when an event is updated
#[event]
pub struct EventUpdated {
    #[index]
    pub event: Pubkey,
    pub organizer: Pubkey,
    pub name: String,
    pub updated_at: i64,
}

/// Event emitted when a ticket type is created
#[event]
pub struct TicketTypeCreated {
    #[index]
    pub event: Pubkey,
    #[index]
    pub ticket_type: Pubkey,
    pub name: String,
    pub price: u64,
    pub quantity: u32,
    pub organizer: Pubkey,
}

/// Event emitted when a ticket type is updated
#[event]
pub struct TicketTypeUpdated {
    #[index]
    pub ticket_type: Pubkey,
    pub name: String,
    pub price: u64,
    pub quantity: u32,
    pub active: bool,
    pub updated_by: Pubkey,
}

/// Event emitted when a ticket is minted
#[event]
pub struct TicketMinted {
    #[index]
    pub ticket: Pubkey,
    #[index]
    pub mint: Pubkey,
    pub event: Pubkey,
    pub ticket_type: Pubkey,
    pub owner: Pubkey,
    pub serial_number: u32,
    pub price: u64,
}

/// Event emitted when a ticket status is updated
#[event]
pub struct TicketStatusUpdated {
    #[index]
    pub ticket: Pubkey,
    pub event: Pubkey,
    pub old_status: TicketStatus,
    pub new_status: TicketStatus,
    pub updated_by: Pubkey,
    pub updated_at: i64,
}

/// Event emitted when a ticket is transferred
#[event]
pub struct TicketTransferred {
    #[index]
    pub ticket: Pubkey,
    #[index]
    pub mint: Pubkey,
    pub event: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub transferred_at: i64,
}

/// Event emitted when a ticket is revoked
#[event]
pub struct TicketRevoked {
    #[index]
    pub ticket: Pubkey,
    pub event: Pubkey,
    pub owner: Pubkey,
    pub revoked_by: Pubkey,
    pub revoked_at: i64,
    pub reason: Option<String>,
}

/// Event emitted when a ticket's transferability is changed
#[event]
pub struct TicketTransferabilityChanged {
    #[index]
    pub ticket: Pubkey,
    pub event: Pubkey,
    pub transferable: bool,
    pub changed_by: Pubkey,
    pub changed_at: i64,
}

/// Event emitted when a validator is added to an event
#[event]
pub struct ValidatorAdded {
    #[index]
    pub event: Pubkey,
    pub validator: Pubkey,
    pub added_by: Pubkey,
    pub added_at: i64,
}

/// Event emitted when a validator is removed from an event
#[event]
pub struct ValidatorRemoved {
    #[index]
    pub event: Pubkey,
    pub validator: Pubkey,
    pub removed_by: Pubkey,
    pub removed_at: i64,
}

/// Event emitted when a ticket is verified for entry
#[event]
pub struct TicketVerified {
    #[index]
    pub ticket: Pubkey,
    pub event: Pubkey,
    pub owner: Pubkey,
    pub verified_by: Pubkey,
    pub verified_at: i64,
    pub marked_as_used: bool,
}

/// Event emitted when multiple tickets are batch updated
#[event]
pub struct TicketsBatchUpdated {
    #[index]
    pub event: Pubkey,
    pub new_status: TicketStatus,
    pub tickets_updated: u32,
    pub updated_by: Pubkey,
    pub updated_at: i64,
}

/// Event emitted when a verification challenge is generated
#[event]
pub struct VerificationChallengeGenerated {
    #[index]
    pub ticket: Pubkey,
    #[index]
    pub challenge: Pubkey,
    pub event: Pubkey,
    pub owner: Pubkey,
    pub generated_by: Pubkey,
    pub expires_at: i64,
}

/// Event emitted when an event's capacity is reached
#[event]
pub struct EventCapacityReached {
    #[index]
    pub event: Pubkey,
    pub max_tickets: u32,
    pub tickets_issued: u32,
    pub reached_at: i64,
}

/// Event emitted when a ticket type is sold out
#[event]
pub struct TicketTypeSoldOut {
    #[index]
    pub event: Pubkey,
    #[index]
    pub ticket_type: Pubkey,
    pub name: String,
    pub quantity: u32,
    pub sold_out_at: i64,
}
