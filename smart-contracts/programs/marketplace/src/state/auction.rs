use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct AuctionConfig {
    pub end_time: i64,           // Unix timestamp when auction ends
    pub min_bid_increment: u64,  // Minimum bid increment in lamports
    pub extension_period: i64,   // Time in seconds to extend auction on last-minute bids
}

#[account]
pub struct Auction {
    // Basic auction data
    pub listing: Pubkey,              // Reference to the listing
    pub end_time: i64,                // When the auction ends (Unix timestamp)
    pub min_bid_increment: u64,       // Minimum bid increment
    pub extension_period: i64,        // Time extension on late bids (seconds)
    
    // Current highest bid info
    pub highest_bidder: Option<Pubkey>, // Current highest bidder (if any)
    pub highest_bid: u64,               // Current highest bid amount
    
    // Tracking
    pub bid_count: u32,              // Number of bids placed
    pub bump: u8,                    // PDA bump
}

impl Auction {
    pub fn is_ended(&self, now: i64) -> bool {
        now >= self.end_time
    }
    
    pub fn size() -> usize {
        8 +     // discriminator
        32 +    // listing
        8 +     // end_time
        8 +     // min_bid_increment
        8 +     // extension_period
        33 +    // highest_bidder (Option<Pubkey>)
        8 +     // highest_bid
        4 +     // bid_count
        1       // bump
    }
}
