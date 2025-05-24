use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_master_edition_v3, create_metadata_accounts_v3, CreateMasterEditionV3,
        CreateMetadataAccountsV3, Metadata,
    },
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};
use mpl_token_metadata::state::{DataV2, Creator, Collection};
use solana_program::clock::Clock;

declare_id!("TicketNFT1111111111111111111111111111111111111");

/// Main ticket NFT program
#[program]
pub mod ticket_nft {
    use super::*;

    /// Initialize the ticket program with admin authority
    pub fn initialize(
        ctx: Context<Initialize>,
        royalty_percentage: u16,
        max_supply: u64,
    ) -> Result<()> {
        require!(royalty_percentage <= 10000, TicketError::InvalidRoyaltyPercentage);

        let program_config = &mut ctx.accounts.program_config;
        program_config.admin = ctx.accounts.admin.key();
        program_config.royalty_percentage = royalty_percentage;
        program_config.max_supply = max_supply;
        program_config.total_minted = 0;
        program_config.is_paused = false;
        program_config.bump = *ctx.bumps.get("program_config").unwrap();

        emit!(ProgramInitialized {
            admin: ctx.accounts.admin.key(),
            royalty_percentage,
            max_supply,
        });

        Ok(())
    }

    /// Add authorized minter
    pub fn add_minter(ctx: Context<ManageMinter>, minter: Pubkey) -> Result<()> {
        require!(!ctx.accounts.program_config.is_paused, TicketError::ProgramPaused);
        
        let minter_config = &mut ctx.accounts.minter_config;
        minter_config.minter = minter;
        minter_config.is_active = true;
        minter_config.total_minted = 0;
        minter_config.bump = *ctx.bumps.get("minter_config").unwrap();

        emit!(MinterAdded {
            admin: ctx.accounts.admin.key(),
            minter,
        });

        Ok(())
    }

    /// Remove authorized minter
    pub fn remove_minter(ctx: Context<ManageMinter>) -> Result<()> {
        let minter_config = &mut ctx.accounts.minter_config;
        minter_config.is_active = false;

        emit!(MinterRemoved {
            admin: ctx.accounts.admin.key(),
            minter: minter_config.minter,
        });

        Ok(())
    }

    /// Mint a single ticket NFT
    pub fn mint_ticket(
        ctx: Context<MintTicket>,
        event_id: String,
        seat_number: String,
        tier: TicketTier,
        event_timestamp: i64,
        metadata_uri: String,
        name: String,
        symbol: String,
    ) -> Result<()> {
        require!(!ctx.accounts.program_config.is_paused, TicketError::ProgramPaused);
        require!(ctx.accounts.minter_config.is_active, TicketError::UnauthorizedMinter);
        require!(
            ctx.accounts.program_config.total_minted < ctx.accounts.program_config.max_supply,
            TicketError::MaxSupplyReached
        );
        require!(event_id.len() <= 50, TicketError::EventIdTooLong);
        require!(seat_number.len() <= 20, TicketError::SeatNumberTooLong);
        require!(name.len() <= 32, TicketError::NameTooLong);
        require!(symbol.len() <= 10, TicketError::SymbolTooLong);

        let clock = Clock::get()?;
        require!(event_timestamp > clock.unix_timestamp, TicketError::EventInPast);

        // Mint NFT token
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_account.to_account_info(),
            authority: ctx.accounts.program_config.to_account_info(),
        };
        let program_config_seeds = &[
            b"program_config",
            &[ctx.accounts.program_config.bump],
        ];
        let signer = &[&program_config_seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        mint_to(cpi_ctx, 1)?;

        // Create metadata
        let creators = vec![
            Creator {
                address: ctx.accounts.program_config.key(),
                verified: true,
                share: 100,
            },
        ];

        let metadata = DataV2 {
            name,
            symbol,
            uri: metadata_uri.clone(),
            seller_fee_basis_points: ctx.accounts.program_config.royalty_percentage,
            creators: Some(creators),
            collection: None,
            uses: None,
        };

        let metadata_accounts = CreateMetadataAccountsV3 {
            metadata: ctx.accounts.metadata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            mint_authority: ctx.accounts.program_config.to_account_info(),
            update_authority: ctx.accounts.program_config.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };

        let metadata_ctx = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            metadata_accounts,
            signer,
        );

        create_metadata_accounts_v3(metadata_ctx, metadata, false, true, None)?;

        // Create master edition
        let master_edition_accounts = CreateMasterEditionV3 {
            edition: ctx.accounts.master_edition.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            update_authority: ctx.accounts.program_config.to_account_info(),
            mint_authority: ctx.accounts.program_config.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };

        let master_edition_ctx = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            master_edition_accounts,
            signer,
        );

        create_master_edition_v3(master_edition_ctx, Some(0))?;

        // Initialize ticket data
        let ticket_data = &mut ctx.accounts.ticket_data;
        ticket_data.mint = ctx.accounts.mint.key();
        ticket_data.event_id = event_id.clone();
        ticket_data.seat_number = seat_number.clone();
        ticket_data.tier = tier;
        ticket_data.event_timestamp = event_timestamp;
        ticket_data.minted_timestamp = clock.unix_timestamp;
        ticket_data.owner = ctx.accounts.recipient.key();
        ticket_data.is_used = false;
        ticket_data.is_transferable = false; // Locked until event
        ticket_data.metadata_uri = metadata_uri;
        ticket_data.bump = *ctx.bumps.get("ticket_data").unwrap();

        // Update counters
        ctx.accounts.program_config.total_minted += 1;
        ctx.accounts.minter_config.total_minted += 1;

        emit!(TicketMinted {
            mint: ctx.accounts.mint.key(),
            recipient: ctx.accounts.recipient.key(),
            minter: ctx.accounts.minter.key(),
            event_id,
            seat_number,
            tier,
            event_timestamp,
        });

        Ok(())
    }

    /// Batch mint multiple tickets for efficiency
    pub fn batch_mint_tickets(
        ctx: Context<BatchMintTickets>,
        tickets: Vec<TicketMintData>,
    ) -> Result<()> {
        require!(!ctx.accounts.program_config.is_paused, TicketError::ProgramPaused);
        require!(ctx.accounts.minter_config.is_active, TicketError::UnauthorizedMinter);
        require!(tickets.len() <= 10, TicketError::BatchSizeTooLarge);
        require!(
            ctx.accounts.program_config.total_minted + tickets.len() as u64 
                <= ctx.accounts.program_config.max_supply,
            TicketError::MaxSupplyReached
        );

        let batch_data = &mut ctx.accounts.batch_data;
        batch_data.minter = ctx.accounts.minter.key();
        batch_data.batch_size = tickets.len() as u8;
        batch_data.timestamp = Clock::get()?.unix_timestamp;
        batch_data.bump = *ctx.bumps.get("batch_data").unwrap();

        // Update counters
        ctx.accounts.program_config.total_minted += tickets.len() as u64;
        ctx.accounts.minter_config.total_minted += tickets.len() as u64;

        emit!(BatchMintInitiated {
            minter: ctx.accounts.minter.key(),
            batch_size: tickets.len(),
            batch_id: batch_data.key(),
        });

        Ok(())
    }

    /// Enable transfer after event date or by admin
    pub fn enable_transfer(ctx: Context<EnableTransfer>) -> Result<()> {
        let ticket_data = &mut ctx.accounts.ticket_data;
        let clock = Clock::get()?;

        // Allow transfer if event has passed OR admin is enabling it
        let can_enable = if ctx.accounts.signer.key() == ctx.accounts.program_config.admin {
            true
        } else {
            clock.unix_timestamp >= ticket_data.event_timestamp
        };

        require!(can_enable, TicketError::TransferNotAllowed);

        ticket_data.is_transferable = true;

        emit!(TransferEnabled {
            mint: ticket_data.mint,
            enabled_by: ctx.accounts.signer.key(),
        });

        Ok(())
    }

    /// Verify content access for ticket holder
    pub fn verify_access(ctx: Context<VerifyAccess>, content_id: String) -> Result<bool> {
        let ticket_data = &ctx.accounts.ticket_data;
        require!(!ticket_data.is_used, TicketError::TicketAlreadyUsed);
        
        let clock = Clock::get()?;
        let has_access = match ticket_data.tier {
            TicketTier::VIP => true, // VIP has access to all content
            TicketTier::Premium => {
                // Premium has access 24 hours before event
                clock.unix_timestamp >= ticket_data.event_timestamp - 86400
            },
            TicketTier::Standard => {
                // Standard has access 1 hour before event
                clock.unix_timestamp >= ticket_data.event_timestamp - 3600
            },
        };

        emit!(AccessVerified {
            mint: ticket_data.mint,
            owner: ctx.accounts.owner.key(),
            content_id,
            has_access,
            tier: ticket_data.tier,
        });

        Ok(has_access)
    }

    /// Mark ticket as used (for event entry)
    pub fn use_ticket(ctx: Context<UseTicket>) -> Result<()> {
        let ticket_data = &mut ctx.accounts.ticket_data;
        require!(!ticket_data.is_used, TicketError::TicketAlreadyUsed);

        let clock = Clock::get()?;
        // Allow usage 1 hour before event start
        require!(
            clock.unix_timestamp >= ticket_data.event_timestamp - 3600,
            TicketError::TooEarlyToUse
        );

        ticket_data.is_used = true;

        emit!(TicketUsed {
            mint: ticket_data.mint,
            owner: ctx.accounts.owner.key(),
            event_id: ticket_data.event_id.clone(),
            used_timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Emergency pause (admin only)
    pub fn pause_program(ctx: Context<PauseProgram>) -> Result<()> {
        ctx.accounts.program_config.is_paused = true;

        emit!(ProgramPaused {
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    /// Unpause program (admin only)
    pub fn unpause_program(ctx: Context<UnpauseProgram>) -> Result<()> {
        ctx.accounts.program_config.is_paused = false;

        emit!(ProgramUnpaused {
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    /// Update royalty percentage (admin only)
    pub fn update_royalty(ctx: Context<UpdateRoyalty>, new_percentage: u16) -> Result<()> {
        require!(new_percentage <= 10000, TicketError::InvalidRoyaltyPercentage);
        
        let old_percentage = ctx.accounts.program_config.royalty_percentage;
        ctx.accounts.program_config.royalty_percentage = new_percentage;

        emit!(RoyaltyUpdated {
            admin: ctx.accounts.admin.key(),
            old_percentage,
            new_percentage,
        });

        Ok(())
    }
}

// ============================================================================
// Account Structs
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProgramConfig::INIT_SPACE,
        seeds = [b"program_config"],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageMinter<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump,
        has_one = admin
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + MinterConfig::INIT_SPACE,
        seeds = [b"minter_config", minter_config.minter.as_ref()],
        bump
    )]
    pub minter_config: Account<'info, MinterConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_id: String, seat_number: String)]
pub struct MintTicket<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    #[account(
        mut,
        seeds = [b"minter_config", minter.key().as_ref()],
        bump = minter_config.bump
    )]
    pub minter_config: Account<'info, MinterConfig>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + TicketData::INIT_SPACE,
        seeds = [b"ticket_data", mint.key().as_ref()],
        bump
    )]
    pub ticket_data: Account<'info, TicketData>,
    
    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = program_config,
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Validated by metadata program
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    
    /// CHECK: Validated by metadata program
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,
    
    /// CHECK: Can be any account, represents the recipient
    pub recipient: UncheckedAccount<'info>,
    
    pub minter: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BatchMintTickets<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    #[account(
        mut,
        seeds = [b"minter_config", minter.key().as_ref()],
        bump = minter_config.bump
    )]
    pub minter_config: Account<'info, MinterConfig>,
    
    #[account(
        init,
        payer = payer,
        space = 8 + BatchData::INIT_SPACE,
        seeds = [b"batch_data", minter.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub batch_data: Account<'info, BatchData>,
    
    pub minter: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnableTransfer<'info> {
    #[account(
        seeds = [b"program_config"],
        bump = program_config.bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    #[account(
        mut,
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump
    )]
    pub ticket_data: Account<'info, TicketData>,
    
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyAccess<'info> {
    #[account(
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
        has_one = owner
    )]
    pub ticket_data: Account<'info, TicketData>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct UseTicket<'info> {
    #[account(
        mut,
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
        has_one = owner
    )]
    pub ticket_data: Account<'info, TicketData>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct PauseProgram<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump,
        has_one = admin
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnpauseProgram<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump,
        has_one = admin
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateRoyalty<'info> {
    #[account(
        mut,
        seeds = [b"program_config"],
        bump = program_config.bump,
        has_one = admin
    )]
    pub program_config: Account<'info, ProgramConfig>,
    
    pub admin: Signer<'info>,
}

// ============================================================================
// Data Structs
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub royalty_percentage: u16,
    pub max_supply: u64,
    pub total_minted: u64,
    pub is_paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MinterConfig {
    pub minter: Pubkey,
    pub is_active: bool,
    pub total_minted: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TicketData {
    pub mint: Pubkey,
    #[max_len(50)]
    pub event_id: String,
    #[max_len(20)]
    pub seat_number: String,
    pub tier: TicketTier,
    pub event_timestamp: i64,
    pub minted_timestamp: i64,
    pub owner: Pubkey,
    pub is_used: bool,
    pub is_transferable: bool,
    #[max_len(200)]
    pub metadata_uri: String,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BatchData {
    pub minter: Pubkey,
    pub batch_size: u8,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TicketTier {
    Standard,
    Premium,
    VIP,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct TicketMintData {
    #[max_len(50)]
    pub event_id: String,
    #[max_len(20)]
    pub seat_number: String,
    pub tier: TicketTier,
    pub event_timestamp: i64,
    #[max_len(200)]
    pub metadata_uri: String,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    pub recipient: Pubkey,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct ProgramInitialized {
    pub admin: Pubkey,
    pub royalty_percentage: u16,
    pub max_supply: u64,
}

#[event]
pub struct MinterAdded {
    pub admin: Pubkey,
    pub minter: Pubkey,
}

#[event]
pub struct MinterRemoved {
    pub admin: Pubkey,
    pub minter: Pubkey,
}

#[event]
pub struct TicketMinted {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub minter: Pubkey,
    pub event_id: String,
    pub seat_number: String,
    pub tier: TicketTier,
    pub event_timestamp: i64,
}

#[event]
pub struct BatchMintInitiated {
    pub minter: Pubkey,
    pub batch_size: usize,
    pub batch_id: Pubkey,
}

#[event]
pub struct TransferEnabled {
    pub mint: Pubkey,
    pub enabled_by: Pubkey,
}

#[event]
pub struct AccessVerified {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub content_id: String,
    pub has_access: bool,
    pub tier: TicketTier,
}

#[event]
pub struct TicketUsed {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub event_id: String,
    pub used_timestamp: i64,
}

#[event]
pub struct ProgramPaused {
    pub admin: Pubkey,
}

#[event]
pub struct ProgramUnpaused {
    pub admin: Pubkey,
}

#[event]
pub struct RoyaltyUpdated {
    pub admin: Pubkey,
    pub old_percentage: u16,
    pub new_percentage: u16,
}

// ============================================================================
// Error Types
// ============================================================================

#[error_code]
pub enum TicketError {
    #[msg("Program is currently paused")]
    ProgramPaused,
    
    #[msg("Unauthorized minter")]
    UnauthorizedMinter,
    
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
    
    #[msg("Event ID too long (max 50 characters)")]
    EventIdTooLong,
    
    #[msg("Seat number too long (max 20 characters)")]
    SeatNumberTooLong,
    
    #[msg("Name too long (max 32 characters)")]
    NameTooLong,
    
    #[msg("Symbol too long (max 10 characters)")]
    SymbolTooLong,
    
    #[msg("Event timestamp is in the past")]
    EventInPast,
    
    #[msg("Transfer not allowed yet")]
    TransferNotAllowed,
    
    #[msg("Ticket already used")]
    TicketAlreadyUsed,
    
    #[msg("Too early to use ticket")]
    TooEarlyToUse,
    
    #[msg("Invalid royalty percentage (max 100%)")]
    InvalidRoyaltyPercentage,
    
    #[msg("Batch size too large (max 10)")]
    BatchSizeTooLarge,
}
