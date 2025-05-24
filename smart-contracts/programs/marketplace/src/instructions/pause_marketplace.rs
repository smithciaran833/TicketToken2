use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct PauseMarketplace<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = marketplace.admin == admin.key() @ MarketplaceError::UnauthorizedAdmin,
        constraint = !marketplace.is_paused @ MarketplaceError::AlreadyPaused
    )]
    pub marketplace: Account<'info, Marketplace>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PauseParams {
    pub pause_level: PauseLevel,
    pub reason: String,
    pub duration: Option<i64>,
    pub affected_features: Vec<Feature>,
}

pub fn pause_marketplace(ctx: Context<PauseMarketplace>, params: PauseParams) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;

    // Validate pause parameters
    require!(params.reason.len() <= 500, MarketplaceError::ReasonTooLong);

    // Update marketplace state
    marketplace.is_paused = true;
    marketplace.pause_level = params.pause_level;
    marketplace.pause_reason = Some(params.reason.clone());
    marketplace.paused_at = Some(clock.unix_timestamp);
    marketplace.pause_duration = params.duration;
    marketplace.affected_features = params.affected_features.clone();

    // Set automatic unpause if duration specified
    if let Some(duration) = params.duration {
        marketplace.auto_unpause_at = Some(clock.unix_timestamp + duration);
    }

    // Emit pause event
    emit!(MarketplacePausedEvent {
        marketplace: marketplace.key(),
        admin: ctx.accounts.admin.key(),
        pause_level: params.pause_level,
        reason: params.reason,
        duration: params.duration,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
