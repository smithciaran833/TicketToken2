use anchor_lang::prelude::*;

use crate::errors::MarketplaceError;

#[derive(Accounts)]
#[instruction(new_fee_bps: u16)]
pub struct UpdateMarketplaceFee<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The marketplace authority account
    #[account(
        constraint = marketplace_authority.key() == authority.key() @ MarketplaceError::InvalidMarketplaceAuthority
    )]
    pub marketplace_authority: AccountInfo<'info>,
}

pub fn handler(
    _ctx: Context<UpdateMarketplaceFee>,
    new_fee_bps: u16,
) -> Result<()> {
    // Validate the fee basis points
    require!(
        new_fee_bps <= 10000,
        MarketplaceError::InvalidFeeBasisPoints
    );
    
    // In a real implementation, we would store the marketplace fee in a global
    // config account and update it here. For simplicity in this example, we're
    // storing fees directly in listing accounts, so this handler just validates
    // that the new fee is within acceptable bounds.
    //
    // A more complete implementation would:
    // 1. Have a marketplace config account
    // 2. Update the fee in that account
    // 3. New listings would read from that account
    
    Ok(())
}
