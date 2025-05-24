use anchor_lang::prelude::*;

#[error_code]
pub enum MarketplaceError {
    #[msg("The provided price must be greater than zero")]
    InvalidPrice,
    
    #[msg("The NFT owner does not match the signer")]
    InvalidOwner,
    
    #[msg("The listing has already been fulfilled or canceled")]
    ListingNoLongerActive,
    
    #[msg("Insufficient funds to purchase ticket")]
    InsufficientFunds,
    
    #[msg("Not enough SOL to create a listing")]
    InsufficientListingFee,
    
    #[msg("Invalid marketplace authority")]
    InvalidMarketplaceAuthority,
    
    #[msg("Invalid royalty recipient")]
    InvalidRoyaltyRecipient,
    
    #[msg("Invalid number of royalty recipients")]
    InvalidRoyaltyRecipients,
    
    #[msg("Total royalty basis points exceeds maximum")]
    InvalidRoyaltyConfig,
    
    #[msg("Arithmetic overflow occurred")]
    Overflow,
    
    #[msg("Auction end time must be in the future")]
    InvalidAuctionEndTime,
    
    #[msg("Auction not yet ended")]
    AuctionNotEnded,
    
    #[msg("Auction already ended")]
    AuctionEnded,
    
    #[msg("Bid amount too low")]
    BidTooLow,
    
    #[msg("Fee basis points cannot exceed 10000 (100%)")]
    InvalidFeeBasisPoints,
    
    #[msg("The ticket is not transferable")]
    TicketNotTransferable,
    
    #[msg("The event has already started")]
    EventAlreadyStarted,
}
