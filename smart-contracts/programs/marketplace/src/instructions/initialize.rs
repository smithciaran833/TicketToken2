use anchor_lang::prelude::*;
use crate::{state::*, errors::*, Initialize};

pub fn handler(
    ctx: Context<Initialize>,
    platform_fee_bps: u16,
    max_royalty_bps: u16,
) -> Result<()> {
    require!(platform_fee_bps <= 1000, MarketplaceError::InvalidFeePercentage); // Max 10%
    require!(max_royalty_bps <= 5000, MarketplaceError::InvalidRoyaltyPercentage); // Max 50%

    let marketplace_config = &mut ctx.accounts.marketplace_config;
    marketplace_config.admin = ctx.accounts.admin.key();
    marketplace_config.platform_fee_bps = platform_fee_bps;
    marketplace_config.max_royalty_bps = max_royalty_bps;
    marketplace_config.total_volume = 0;
    marketplace_config.total_fees_collected = 0;
    marketplace_config.is_paused = false;
    marketplace_config.bump = *ctx.bumps.get("marketplace_config").unwrap();

    Ok(())
}
