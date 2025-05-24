use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;
use state::*;
use errors::*;

declare_id!("TicketToken11111111111111111111111111111111");

#[program]
pub mod tickettoken {
    use super::*;

    /// Initialize the ticket token program
    pub fn initialize_program(
        ctx: Context<InitializeProgram>,
        program_authority: Pubkey,
        marketplace_fee_bps: u16,
        royalty_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, program_authority, marketplace_fee_bps, royalty_fee_bps)
    }

    /// Mint a new ticket NFT
    pub fn mint_ticket(
        ctx: Context<MintTicket>,
        event_id: String,
        ticket_type: TicketType,
        metadata: TicketMetadata,
        transfer_restrictions: TransferRestrictions,
        content_access: Vec<ContentAccess>,
        royalty_recipients: Vec<RoyaltyRecipient>,
    ) -> Result<()> {
        instructions::mint_ticket::handler(
            ctx,
            event_id,
            ticket_type,
            metadata,
            transfer_restrictions,
            content_access,
            royalty_recipients,
        )
    }

    /// Transfer ticket with restrictions
    pub fn transfer_ticket(
        ctx: Context<TransferTicket>,
        transfer_type: TransferType,
    ) -> Result<()> {
        instructions::transfer_ticket::handler(ctx, transfer_type)
    }

    /// Verify ticket ownership and grant content access
    pub fn verify_ownership(
        ctx: Context<VerifyOwnership>,
        content_id: String,
    ) -> Result<()> {
        instructions::verify_ownership::handler(ctx, content_id)
    }

    /// Grant content access to ticket holder
    pub fn grant_content_access(
        ctx: Context<GrantContentAccess>,
        content_id: String,
        access_level: AccessLevel,
    ) -> Result<()> {
        instructions::grant_content_access::handler(ctx, content_id, access_level)
    }

    /// Create marketplace listing
    pub fn create_listing(
        ctx: Context<CreateListing>,
        price: u64,
        listing_type: ListingType,
        duration: Option<i64>,
    ) -> Result<()> {
        instructions::create_listing::handler(ctx, price, listing_type, duration)
    }

    /// Purchase ticket from marketplace
    pub fn purchase_ticket(
        ctx: Context<PurchaseTicket>,
    ) -> Result<()> {
        instructions::purchase_ticket::handler(ctx)
    }

    /// Cancel marketplace listing
    pub fn cancel_listing(
        ctx: Context<CancelListing>,
    ) -> Result<()> {
        instructions::cancel_listing::handler(ctx)
    }

    /// Distribute royalties to artists/creators
    pub fn distribute_royalty(
        ctx: Context<DistributeRoyalty>,
        sale_amount: u64,
    ) -> Result<()> {
        instructions::distribute_royalty::handler(ctx, sale_amount)
    }

    /// Use ticket for event entry
    pub fn use_ticket(
        ctx: Context<UseTicket>,
        verification_code: String,
    ) -> Result<()> {
        instructions::use_ticket::handler(ctx, verification_code)
    }

    /// Update ticket metadata (admin only)
    pub fn update_metadata(
        ctx: Context<UpdateMetadata>,
        new_metadata: TicketMetadata,
    ) -> Result<()> {
        instructions::update_metadata::handler(ctx, new_metadata)
    }

    /// Pause/unpause program (emergency)
    pub fn set_program_pause(
        ctx: Context<SetProgramPause>,
        paused: bool,
    ) -> Result<()> {
        instructions::set_program_pause::handler(ctx, paused)
    }

    /// Update program fees
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        marketplace_fee_bps: u16,
        royalty_fee_bps: u16,
    ) -> Result<()> {
        instructions::update_fees::handler(ctx, marketplace_fee_bps, royalty_fee_bps)
    }
}
