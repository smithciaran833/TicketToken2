/// Mints a new ticket NFT
    pub fn mint_ticket(
        ctx: Context<MintTicket>,
        metadata_uri: String,
        custom_attributes: Option<Vec<TicketAttribute>>,
    ) -> Result<()> {
        let ticket_type = &ctx.accounts.ticket_type;
        let result = instructions::minting::mint_ticket(ctx, metadata_uri, custom_attributes)?;
        
        emit!(TicketMinted {
            ticket: ctx.accounts.ticket.key(),
            mint: ctx.accounts.mint.key(),
            event: ctx.accounts.event.key(),
            ticket_type: ctx.accounts.ticket_type.key(),
            owner: ctx.accounts.buyer.key(),
            serial_number: ticket_type.sold,
            price: ticket_type.price,
        });
        
        Ok(result)
    }

    /// Updates a ticket's status
    pub fn update_ticket_status(
        ctx: Context<UpdateTicketStatus>,
        new_status: TicketStatus,
    ) -> Result<()> {
        let old_status = ctx.accounts.ticket.status;
        let result = instructions::tickets::update_ticket_status(ctx, new_status)?;
        
        emit!(TicketStatusUpdated {
            ticket: ctx.accounts.ticket.key(),
            event: ctx.accounts.event.key(),
            old_status,
            new_status,
            updated_by: ctx.accounts.validator.key(),
            updated_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }

    /// Transfers a ticket to a new owner
    pub fn transfer_ticket(
        ctx: Context<TransferTicket>,
    ) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let from = ticket.owner;
        let to = ctx.accounts.to.key();
        let result = instructions::tickets::transfer_ticket(ctx)?;
        
        emit!(TicketTransferred {
            ticket: ticket.key(),
            mint: ctx.accounts.mint.key(),
            event: ticket.event,
            from,
            to,
            transferred_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }

    /// Updates an event's details
    pub fn update_event(
        ctx: Context<UpdateEvent>,
        name: Option<String>,
        description: Option<String>,
        venue: Option<String>,
        start_date: Option<i64>,
        end_date: Option<i64>,
    ) -> Result<()> {
        let result = instructions::events::update_event(ctx, name.clone(), description, venue, start_date, end_date)?;
        
        emit!(EventUpdated {
            event: ctx.accounts.event.key(),
            organizer: ctx.accounts.organizer.key(),
            name: name.unwrap_or_else(|| ctx.accounts.event.name.clone()),
            updated_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }

    /// Adds an authorized validator for an event
    pub fn add_validator(
        ctx: Context<AddValidator>,
        validator: Pubkey,
    ) -> Result<()> {
        let result = instructions::events::add_validator(ctx, validator)?;
        
        emit!(ValidatorAdded {
            event: ctx.accounts.event.key(),
            validator,
            added_by: ctx.accounts.organizer.key(),
            added_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }

    /// Removes an authorized validator for an event
    pub fn remove_validator(
        ctx: Context<RemoveValidator>,
        validator: Pubkey,
    ) -> Result<()> {
        let result = instructions::events::remove_validator(ctx, validator)?;
        
        emit!(ValidatorRemoved {
            event: ctx.accounts.event.key(),
            validator,
            removed_by: ctx.accounts.organizer.key(),
            removed_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }
    
    /// Verifies a ticket for entry to an event
    pub fn verify_ticket_for_entry(
        ctx: Context<VerifyTicketForEntry>,
    ) -> Result<()> {
        let result = instructions::verification::verify_ticket_for_entry(ctx)?;
        
        emit!(TicketVerified {
            ticket: ctx.accounts.ticket.key(),
            event: ctx.accounts.event.key(),
            owner: ctx.accounts.ticket_owner.key(),
            verified_by: ctx.accounts.validator.key(),
            verified_at: Clock::get()?.unix_timestamp,
            marked_as_used: false,
        });
        
        Ok(result)
    }
    
    /// Verifies a ticket and marks it as used
    pub fn verify_and_mark_used(
        ctx: Context<VerifyTicketForEntry>,
    ) -> Result<()> {
        let result = instructions::verification::verify_and_mark_used(ctx)?;
        
        emit!(TicketVerified {
            ticket: ctx.accounts.ticket.key(),
            event: ctx.accounts.event.key(),
            owner: ctx.accounts.ticket_owner.key(),
            verified_by: ctx.accounts.validator.key(),
            verified_at: Clock::get()?.unix_timestamp,
            marked_as_used: true,
        });
        
        Ok(result)
    }
    
    /// Verifies user has ticket for event access
    pub fn verify_user_has_ticket_for_event(
        ctx: Context<VerifyEventAccess>,
    ) -> Result<()> {
        instructions::verification::verify_user_has_ticket_for_event(ctx)
    }
    
    /// Verifies ownership of multiple tickets
    pub fn verify_multiple_tickets(
        ctx: Context<VerifyMultipleTickets>,
        ticket_mints: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::verification::verify_multiple_tickets(ctx, ticket_mints)
    }
    
    /// Generates a verification challenge
    pub fn generate_verification_challenge(
        ctx: Context<GenerateChallenge>,
        nonce: u64,
    ) -> Result<()> {
        let result = instructions::verification::generate_verification_challenge(ctx)?;
        
        emit!(VerificationChallengeGenerated {
            ticket: ctx.accounts.ticket.key(),
            challenge: ctx.accounts.verification_account.key(),
            event: ctx.accounts.event.key(),
            owner: ctx.accounts.ticket_owner.key(),
            generated_by: ctx.accounts.validator.key(),
            expires_at: ctx.accounts.verification_account.expiration,
        });
        
        Ok(result)
    }
    
    /// Revokes a ticket
    pub fn revoke_ticket(
        ctx: Context<RevokeTicket>,
        reason: Option<String>,
    ) -> Result<()> {
        let ticket = &ctx.accounts.ticket;
        let owner = ticket.owner;
        let result = instructions::tickets::revoke_ticket(ctx)?;
        
        emit!(TicketRevoked {
            ticket: ticket.key(),
            event: ctx.accounts.event.key(),
            owner,
            revoked_by: ctx.accounts.organizer.key(),
            revoked_at: Clock::get()?.unix_timestamp,
            reason,
        });
        
        Ok(result)
    }
    
    /// Sets ticket transferability
    pub fn set_ticket_transferability(
        ctx: Context<SetTicketTransferability>,
        transferable: bool,
    ) -> Result<()> {
        let result = instructions::tickets::set_ticket_transferability(ctx, transferable)?;
        
        emit!(TicketTransferabilityChanged {
            ticket: ctx.accounts.ticket.key(),
            event: ctx.accounts.event.key(),
            transferable,
            changed_by: ctx.accounts.organizer.key(),
            changed_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }
    
    /// Batch updates ticket status
    pub fn batch_update_ticket_status(
        ctx: Context<BatchUpdateTicketStatus>,
        new_status: TicketStatus,
    ) -> Result<()> {
        let result = instructions::tickets::batch_update_ticket_status(ctx, new_status)?;
        
        emit!(TicketsBatchUpdated {
            event: ctx.accounts.event.key(),
            new_status,
            tickets_updated: ctx.remaining_accounts.len() as u32,
            updated_by: ctx.accounts.validator.key(),
            updated_at: Clock::get()?.unix_timestamp,
        });
        
        Ok(result)
    }
    
    /// Updates a ticket type
    pub fn update_ticket_type(
        ctx: Context<UpdateTicketType>,
        name: Option<String>,
        description: Option<String>,
        price: Option<u64>,
        quantity: Option<u32>,
        active: Option<bool>,
    ) -> Result<()> {
        let ticket_type = &ctx.accounts.ticket_type;
        let result = instructions::ticket_types::update_ticket_type(ctx, name.clone(), description, price, quantity, active)?;
        
        emit!(TicketTypeUpdated {
            ticket_type: ticket_type.key(),
            name: name.unwrap_or_else(|| ticket_type.name.clone()),
            price: price.unwrap_or(ticket_type.price),
            quantity: quantity.unwrap_or(ticket_type.quantity),
            active: active.unwrap_or(ticket_type.active),
            updated_by: ctx.accounts.organizer.key(),
        });
        
        Ok(result)
    }
    
    /// Sets ticket type active status
    pub fn set_ticket_type_active(
        ctx: Context<SetTicketTypeActive>,
        active: bool,
    ) -> Result<()> {
        instructions::ticket_types::set_ticket_type_active(ctx, active)
    }

    // Marketplace functions from the marketplace.rs instruction handler
    pub fn create_listing(
        ctx: Context<CreateListing>,
        listing_id: String,
        price: u64,
    ) -> Result<()> {
        instructions::marketplace::create_listing(ctx, listing_id, price)
    }

    pub fn create_auction(
        ctx: Context<CreateListing>,
        listing_id: String,
        start_price: u64,
        min_bid_increment: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        instructions::marketplace::create_auction(ctx, listing_id, start_price, min_bid_increment, duration_seconds)
    }

    pub fn create_dutch_auction(
        ctx: Context<CreateListing>,
        listing_id: String,
        start_price: u64,
        end_price: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        instructions::marketplace::create_dutch_auction(ctx, listing_id, start_price, end_price, duration_seconds)
    }

    pub fn cancel_listing(
        ctx: Context<CancelListing>,
    ) -> Result<()> {
        instructions::marketplace::cancel_listing(ctx)
    }

    pub fn purchase_listing(
        ctx: Context<PurchaseListing>,
    ) -> Result<()> {
        instructions::marketplace::purchase_listing(ctx)
    }

    pub fn place_bid(
        ctx: Context<PlaceBid>,
        bid_amount: u64,
    ) -> Result<()> {
        instructions::marketplace::place_bid(ctx, bid_amount)
    }

    pub fn settle_auction(
        ctx: Context<SettleAuction>,
    ) -> Result<()> {
        instructions::marketplace::settle_auction(ctx)
    }

    pub fn make_offer(
        ctx: Context<MakeOffer>,
        offer_amount: u64,
        expiry_seconds: Option<i64>,
    ) -> Result<()> {
        instructions::marketplace::make_offer(ctx, offer_amount, expiry_seconds)
    }

    pub fn accept_offer(
        ctx: Context<AcceptOffer>,
    ) -> Result<()> {
        instructions::marketplace::accept_offer(ctx)
    }

    // Transfer listing functions
    pub fn create_transfer_listing(
        ctx: Context<CreateTransferListing>,
        price: u64,
        allow_direct_transfer: bool,
    ) -> Result<()> {
        instructions::transfers::create_transfer_listing(ctx, price, allow_direct_transfer)
    }

    pub fn cancel_transfer_listing(
        ctx: Context<CancelTransferListing>,
    ) -> Result<()> {
        instructions::transfers::cancel_transfer_listing(ctx)
    }

    pub fn accept_transfer_listing(
        ctx: Context<AcceptTransferListing>,
    ) -> Result<()> {
        instructions::transfers::accept_transfer_listing(ctx)
    }
}

/// Global ticket minter configuration
#[account]
pub struct TicketMinter {
    /// Program authority
    pub authority: Pubkey,
    /// Treasury account for platform fees
    pub treasury: Pubkey,
    /// Configuration settings
    pub config: TicketMinterConfig,
    /// Total events created
    pub total_events: u64,
    /// Total tickets minted across all events
    pub total_tickets_minted: u64,
    /// Bump seed
    pub bump: u8,
}

/// Configuration for the ticket minter
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TicketMinterConfig {
    /// Platform fee in basis points (e.g., 250 = 2.5%)
    pub platform_fee_bps: u16,
    /// Maximum number of validators per event
    pub max_validators_per_event: u8,
    /// Maximum events per organizer
    pub max_events_per_organizer: u32,
    /// Whether the program is paused
    pub paused: bool,
}

impl Default for TicketMinterConfig {
    fn default() -> Self {
        Self {
            platform_fee_bps: 250, // 2.5%
            max_validators_per_event: 10,
            max_events_per_organizer: 100,
            paused: false,
        }
    }
}

impl TicketMinter {
    pub const SPACE: usize = 8 + // discriminator
        32 + // authority
        32 + // treasury
        (2 + 1 + 4 + 1) + // config
        8 + // total_events
        8 + // total_tickets_minted
        1 + // bump
        100; // padding
}

/// Context for initializing the ticket minter
#[derive(Accounts)]
pub struct InitializeTicketMinter<'info> {
    /// The ticket minter configuration account
    #[account(
        init,
        payer = authority,
        space = TicketMinter::SPACE,
        seeds = [b"ticket_minter"],
        bump
    )]
    pub ticket_minter: Account<'info, TicketMinter>,
    
    /// The program authority
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// The treasury account
    /// CHECK: Can be any account that will receive fees
    pub treasury: UncheckedAccount<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
}

/// Event for when ticket minter is initialized
#[event]
pub struct TicketMinterInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub platform_fee_bps: u16,
}

/// Context for creating a new event
#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct CreateEvent<'info> {
    /// The event account to be created
    #[account(
        init,
        payer = organizer,
        space = Event::space(&event_id),
        seeds = [b"event", organizer.key().as_ref(), event_id.as_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,

    /// The organizer creating the event
    #[account(mut)]
    pub organizer: Signer<'info>,

    /// The system program
    pub system_program: Program<'info, System>,
}

/// Context for creating a new ticket type
#[derive(Accounts)]
#[instruction(ticket_type_id: String)]
pub struct CreateTicketType<'info> {
    /// The event this ticket type belongs to
    #[account(mut, has_one = organizer)]
    pub event: Account<'info, Event>,

    /// The ticket type account to be created
    #[account(
        init,
        payer = organizer,
        space = TicketType::space(&ticket_type_id),
        seeds = [b"ticket_type", event.key().as_ref(), ticket_type_id.as_bytes()],
        bump
    )]
    pub ticket_type: Account<'info, TicketType>,

    /// The organizer creating the ticket type
    #[account(mut)]
    pub organizer: Signer<'info>,

    /// The system program
    pub system_program: Program<'info, System>,
}

/// Context for minting a new ticket
#[derive(Accounts)]
pub struct MintTicket<'info> {
    /// The event for this ticket
    #[account(mut)]
    pub event: Account<'info, Event>,

    /// The ticket type being minted
    #[account(mut, constraint = ticket_type.event == event.key())]
    pub ticket_type: Account<'info, TicketType>,

    /// The mint account for the NFT
    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = ticket_mint_authority,
        mint::freeze_authority = ticket_mint_authority,
    )]
    pub mint: Account<'info, Mint>,

    /// The PDA that has authority over the mint
    #[account(
        seeds = [b"ticket_authority", mint.key().as_ref()],
        bump
    )]
    /// CHECK: This is a PDA, safe because we control the seeds
    pub ticket_mint_authority: UncheckedAccount<'info>,

    /// The buyer's token account to receive the NFT
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub token_account: Account<'info, TokenAccount>,

    /// The ticket metadata account through Metaplex
    /// CHECK: Created through CPI to Metaplex
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// The master edition account through Metaplex
    /// CHECK: Created through CPI to Metaplex
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    /// The ticket account that stores additional information
    #[account(
        init,
        payer = buyer,
        space = Ticket::SPACE,
        seeds = [b"ticket", mint.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,

    /// The buyer of the ticket
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// The event organizer receiving payment
    /// CHECK: Constraint validates this is the event organizer
    #[account(mut, constraint = organizer.key() == event.organizer)]
    pub organizer: UncheckedAccount<'info>,

    /// Metaplex Token Metadata program
    /// CHECK: This is the Metaplex program
    pub token_metadata_program: UncheckedAccount<'info>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// Associated Token program
    pub associated_token_program: Program<'info, AssociatedToken>,

    /// System program
    pub system_program: Program<'info, System>,

    /// Rent sysvar
    pub rent: Sysvar<'info, Rent>,
}

/// Context for updating a ticket's status
#[derive(Accounts)]
pub struct UpdateTicketStatus<'info> {
    /// The event this ticket belongs to
    pub event: Account<'info, Event>,

    /// The ticket to update
    #[account(mut, constraint = ticket.event == event.key())]
    pub ticket: Account<'info, Ticket>,

    /// The validator updating the status
    #[account(constraint = event.is_validator(validator.key()))]
    pub validator: Signer<'info>,
}

/// Context for transferring a ticket
#[derive(Accounts)]
pub struct TransferTicket<'info> {
    /// The ticket being transferred
    #[account(mut, constraint = ticket.status == TicketStatus::Valid)]
    pub ticket: Account<'info, Ticket>,

    /// The mint of the ticket NFT
    pub mint: Account<'info, Mint>,

    /// The current owner's token account
    #[account(
        mut,
        constraint = from_token_account.owner == from.key(),
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, TokenAccount>,

    /// The recipient's token account
    #[account(
        mut,
        constraint = to_token_account.mint == mint.key(),
    )]
    pub to_token_account: Account<'info, TokenAccount>,

    /// The current owner transferring the ticket
    #[account(constraint = from.key() == ticket.owner)]
    pub from: Signer<'info>,

    /// The recipient of the ticket
    /// CHECK: We validate this is the owner of to_token_account
    pub to: UncheckedAccount<'info>,

    /// Token program
    pub token_program: Program<'info, Token>,
}

/// Context for updating event details
#[derive(Accounts)]
pub struct UpdateEvent<'info> {
    /// The event to update
    #[account(mut, has_one = organizer)]
    pub event: Account<'info, Event>,

    /// The organizer who created the event
    pub organizer: Signer<'info>,
}

/// Context for adding a validator
#[derive(Accounts)]
pub struct AddValidator<'info> {
    /// The event to update
    #[account(mut, has_one = organizer)]
    pub event: Account<'info, Event>,

    /// The organizer who created the event
    pub organizer: Signer<'info>,
}

/// Context for removing a validator
#[derive(Accounts)]
pub struct RemoveValidator<'info> {
    /// The event to update
    #[account(mut, has_one = organizer)]
    pub event: Account<'info, Event>,

    /// The organizer who created the event
    pub organizer: Signer<'info>,
}
