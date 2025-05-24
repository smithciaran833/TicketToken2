use anchor_lang::prelude::*;
use crate::state::royalty::RoyaltyConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ListingType {
    FixedPrice,
    Auction,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum ListingState {
    Active,
    Sold,
    Canceled,
}

#[account]
pub struct Listing {
    // Listing metadata
    pub seller: Pubkey,                  // The wallet that created the listing
    pub ticket_mint: Pubkey,             // The NFT mint address
    pub price: u64,                      // Price in lamports (or minimum bid for auctions)
    pub listing_type: ListingType,       // Fixed price or auction
    pub state: ListingState,             // Current state of the listing
    
    // Marketplace params
    pub marketplace_authority: Pubkey,   // The marketplace authority (for fees)
    pub marketplace_fee_bps: u16,        // Fee in basis points (e.g., 250 = 2.5%)
    
    // Event & royalty info
    pub event_pubkey: Pubkey,            // Reference to the event
    pub royalty_recipient: Pubkey,       // Legacy: Single wallet to receive royalties
    pub royalty_bps: u16,                // Legacy: Royalty percentage in basis points
    
    // Enhanced royalty configuration (optional)
    pub royalty_config: Option<RoyaltyConfig>, // Advanced royalty distribution rules
    
    // If this is an auction, we'll have an associated auction account
    pub auction_account: Option<Pubkey>, // Only present for auction listings
    
    // Additional ticket metadata
    pub transferable: bool,              // Whether the ticket can be transferred
    pub event_start_time: i64,           // Unix timestamp when event starts
    
    // Anchor account tracking
    pub bump: u8,
}

impl Listing {
    // Calculate total royalty fee based on sale price
    pub fn calculate_royalty_fee(&self, sale_price: u64) -> Result<u64> {
        // If we have enhanced royalty config, use that
        if let Some(config) = &self.royalty_config {
            let effective_bps = config.effective_basis_points(sale_price)?;
            
            return Ok((sale_price as u128)
                .checked_mul(effective_bps as u128)
                .unwrap()
                .checked_div(10000)
                .unwrap() as u64);
        }
        
        // Otherwise, use legacy flat royalty rate
        Ok((sale_price as u128)
            .checked_mul(self.royalty_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64)
    }
    
    // Calculate marketplace fee
    pub fn calculate_marketplace_fee(&self, sale_price: u64) -> u64 {
        (sale_price as u128)
            .checked_mul(self.marketplace_fee_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64
    }
    
    // Calculate seller proceeds after fees
    pub fn calculate_seller_proceeds(&self, sale_price: u64) -> Result<u64> {
        let marketplace_fee = self.calculate_marketplace_fee(sale_price);
        let royalty_fee = self.calculate_royalty_fee(sale_price)?;
        
        sale_price
            .checked_sub(marketplace_fee)
            .unwrap()
            .checked_sub(royalty_fee)
            .ok_or(ErrorCode::Overflow.into())
    }
}
