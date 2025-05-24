use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::MarketplaceError;

#[derive(Accounts)]
pub struct UnpauseMarketplace<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = marketplace.admin == admin.key() @ MarketplaceError::UnauthorizedAdmin,
        constraint = marketplace.is_paused @ MarketplaceError::NotPaused
    )]
    pub marketplace: Account<'info, Marketplace>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UnpauseParams {
    pub gradual_rollout: bool,
    pub features_to_enable: Vec<Feature>,
}

pub fn unpause_marketplace(ctx: Context<UnpauseMarketplace>, params: UnpauseParams) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;

    // Perform safety checks before unpause
    require!(
        marketplace.system_health_check(),
        MarketplaceError::SystemHealthCheckFailed
    );

    if params.gradual_rollout {
        // Gradual unpause - enable specific features
        marketplace.pause_level = PauseLevel::Partial;
        marketplace.affected_features = marketplace.affected_features
            .iter()
            .filter(|f| !params.features_to_enable.contains(f))
            .cloned()
            .collect();
            
        if marketplace.affected_features.is_empty() {
            marketplace.is_paused = false;
            marketplace.pause_level = PauseLevel::None;
        }
    } else {
        // Full unpause
        marketplace.is_paused = false;
        marketplace.pause_level = PauseLevel::None;
        marketplace.affected_features.clear();
    }

    // Clear pause-related fields if fully unpaused
    if !marketplace.is_paused {
        marketplace.pause_reason = None;
        marketplace.paused_at = None;
        marketplace.pause_duration = None;
        marketplace.auto_unpause_at = None;
        marketplace.unpaused_at = Some(clock.unix_timestamp);
    }

    // Emit unpause event
    emit!(MarketplaceUnpausedEvent {
        marketplace: marketplace.key(),
        admin: ctx.accounts.admin.key(),
        gradual_rollout: params.gradual_rollout,
        enabled_features: params.features_to_enable,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
