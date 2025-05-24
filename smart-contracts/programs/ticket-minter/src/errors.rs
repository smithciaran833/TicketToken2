//! Program error definitions
//!
//! This module contains custom error types for the TicketToken program.

use anchor_lang::prelude::*;

/// Errors that can occur in the TicketToken program
#[error_code]
pub enum TicketError {
    /// Event has reached maximum ticket capacity
    #[msg("Event has reached maximum ticket capacity")]
    EventAtCapacity,

    /// Ticket type has sold out
    #[msg("Ticket type has sold out")]
    TicketTypeSoldOut,

    /// Ticket is not valid for entry
    #[msg("Ticket is not valid for entry")]
    InvalidTicket,

    /// Event has already ended
    #[msg("Event has already ended")]
    EventEnded,

    /// Ticket is not transferable
    #[msg("Ticket is not transferable")]
    NotTransferable,

    /// Caller is not authorized for this action
    #[msg("Caller is not authorized for this action")]
    Unauthorized,

    /// Ticket price mismatch
    #[msg("Incorrect payment amount for ticket purchase")]
    IncorrectPaymentAmount,

    /// Invalid event dates
    #[msg("End date must be after start date")]
    InvalidEventDates,

    /// Event not found
    #[msg("Event not found")]
    EventNotFound,

    /// Ticket type not found
    #[msg("Ticket type not found")]
    TicketTypeNotFound,

    /// Ticket not found
    #[msg("Ticket not found")]
    TicketNotFound,

    /// Exceeds maximum validators
    #[msg("Maximum number of validators reached")]
    MaxValidatorsExceeded,

    /// Validator already exists
    #[msg("Validator already exists for this event")]
    ValidatorAlreadyExists,

    /// Validator does not exist
    #[msg("Validator does not exist for this event")]
    ValidatorNotFound,

    /// Metadata error
    #[msg("Error creating or updating NFT metadata")]
    MetadataError,

    /// Insufficient funds
    #[msg("Insufficient funds to complete transaction")]
    InsufficientFunds,

    /// Invalid attribute
    #[msg("Invalid ticket attribute")]
    InvalidAttribute,

    /// Invalid ticket status
    #[msg("Invalid ticket status")]
    InvalidStatus,
    
    /// Event is inactive
    #[msg("Event is inactive")]
    EventInactive,
    
    /// Ticket type is inactive
    #[msg("Ticket type is inactive")]
    TicketTypeInactive,

    /// Ticket owner mismatch
    #[msg("Ticket is not owned by the specified account")]
    TicketOwnerMismatch,

    /// Ticket event mismatch
    #[msg("Ticket is not for the specified event")]
    TicketEventMismatch,

    /// Ticket mint mismatch
    #[msg("Ticket mint does not match the specified mint")]
    TicketMintMismatch,

    /// Verification expired
    #[msg("Verification challenge has expired")]
    VerificationExpired,

    /// Invalid verification signature
    #[msg("Invalid verification signature")]
    InvalidVerificationSignature,

    /// Event not started
    #[msg("Event has not started yet")]
    EventNotStarted,

    /// Missing ticket account
    #[msg("Expected ticket account not provided")]
    MissingTicketAccount,

    /// Missing token account
    #[msg("Expected token account not provided")]
    MissingTokenAccount,
    
    /// Listing inactive
    #[msg("The transfer listing is no longer active")]
    ListingInactive,
    
    /// Listing expired
    #[msg("The transfer listing has expired")]
    ListingExpired,
    
    /// Ticket owner changed
    #[msg("The ticket owner has changed since the listing was created")]
    TicketOwnerChanged,
    
    /// Transfer record full
    #[msg("The transfer record has reached maximum capacity")]
    TransferRecordFull,
    
    /// Price exceeds maximum
    #[msg("The price exceeds the maximum allowed")]
    PriceExceedsMaximum,
    
    /// Transfer limits exceeded
    #[msg("Transfer limits have been exceeded for this ticket")]
    TransferLimitsExceeded,
    
    /// Invalid payment token
    #[msg("Invalid payment token for this transaction")]
    InvalidPaymentToken,
    
    /// Listing already exists
    #[msg("A transfer listing already exists for this ticket")]
    ListingAlreadyExists
}
