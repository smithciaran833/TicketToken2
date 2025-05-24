# TicketToken Smart Contracts Documentation

## Overview

This documentation covers all smart contracts in the TicketToken ecosystem built on Solana using the Anchor framework. The platform consists of multiple interconnected programs that handle NFT ticketing, marketplace operations, governance, and staking mechanisms.

## Contract Architecture

```
tickettoken/contracts/
├── programs/
│   ├── ticket-minter/           # Core NFT ticketing
│   ├── event-manager/           # Event lifecycle management
│   ├── marketplace/             # Secondary market trading
│   ├── governance/              # DAO governance
│   ├── treasury/                # Treasury management
│   ├── staking/                 # Token staking
│   └── rewards/                 # Reward distribution
├── app/                         # Client SDK
├── tests/                       # Integration tests
├── migrations/                  # Deployment scripts
├── target/                      # Build outputs
├── Anchor.toml                  # Anchor configuration
├── Cargo.toml                   # Rust dependencies
└── README.md                    # Contracts overview
```

## 1. Ticket Minter Program

**Location**: `tickettoken/contracts/programs/ticket-minter/src/lib.rs`
**Program ID**: `TktMint...` (Replace with actual deployed address)
**Purpose**: Handles the creation and management of NFT tickets

### Program Structure

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("TktMint...");

#[program]
pub mod ticket_minter {
    use super::*;

    /// Initialize a new event
    pub fn create_event(
        ctx: Context<CreateEvent>,
        event_id: String,
        title: String,
        capacity: u32,
        start_time: i64,
        end_time: i64,
        validator_key: Pubkey,
    ) -> Result<()> {
        let event = &mut ctx.accounts.event;
        event.event_id = event_id;
        event.organizer = ctx.accounts.organizer.key();
        event.title = title;
        event.capacity = capacity;
        event.start_time = start_time;
        event.end_time = end_time;
        event.status = EventStatus::Active;
        event.validator_key = validator_key;
        event.total_tickets_sold = 0;
        event.created_at = Clock::get()?.unix_timestamp;
        event.bump = *ctx.bumps.get("event").unwrap();
        
        emit!(EventCreated {
            event_id: event.event_id.clone(),
            organizer: event.organizer,
            capacity: event.capacity,
        });
        
        Ok(())
    }

    /// Create a ticket type for an event
    pub fn create_ticket_type(
        ctx: Context<CreateTicketType>,
        ticket_type_id: String,
        name: String,
        price: u64,
        currency: Currency,
        max_supply: u32,
        sale_start: i64,
        sale_end: i64,
        transferable: bool,
        resellable: bool,
    ) -> Result<()> {
        let ticket_type = &mut ctx.accounts.ticket_type;
        ticket_type.ticket_type_id = ticket_type_id;
        ticket_type.event = ctx.accounts.event.key();
        ticket_type.name = name;
        ticket_type.price = price;
        ticket_type.currency = currency;
        ticket_type.max_supply = max_supply;
        ticket_type.current_supply = 0;
        ticket_type.sale_start = sale_start;
        ticket_type.sale_end = sale_end;
        ticket_type.transferable = transferable;
        ticket_type.resellable = resellable;
        ticket_type.is_active = true;
        ticket_type.created_at = Clock::get()?.unix_timestamp;
        ticket_type.bump = *ctx.bumps.get("ticket_type").unwrap();
        
        Ok(())
    }

    /// Mint a ticket NFT
    pub fn mint_ticket(
        ctx: Context<MintTicket>,
        ticket_metadata: TicketMetadata,
    ) -> Result<()> {
        let ticket_type = &mut ctx.accounts.ticket_type;
        let event = &ctx.accounts.event;
        
        // Validate sale period
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= ticket_type.sale_start && current_time <= ticket_type.sale_end,
            TicketError::SaleNotActive
        );
        
        // Check supply limits
        require!(
            ticket_type.current_supply < ticket_type.max_supply,
            TicketError::SoldOut
        );
        
        // Mint NFT to buyer
        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.ticket_mint.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.event.to_account_info(),
        };
        let seeds = &[
            b"event",
            event.event_id.as_bytes(),
            &[event.bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::mint_to(cpi_ctx, 1)?;
        
        // Create ticket record
        let ticket = &mut ctx.accounts.ticket;
        ticket.ticket_mint = ctx.accounts.ticket_mint.key();
        ticket.event = event.key();
        ticket.ticket_type = ticket_type.key();
        ticket.owner = ctx.accounts.buyer.key();
        ticket.purchase_price = ticket_type.price;
        ticket.currency = ticket_type.currency;
        ticket.status = TicketStatus::Valid;
        ticket.metadata = ticket_metadata;
        ticket.created_at = current_time;
        ticket.bump = *ctx.bumps.get("ticket").unwrap();
        
        // Update counters
        ticket_type.current_supply += 1;
        
        emit!(TicketMinted {
            ticket_mint: ticket.ticket_mint,
            event_id: event.event_id.clone(),
            owner: ticket.owner,
            price: ticket.purchase_price,
        });
        
        Ok(())
    }

    /// Validate a ticket (mark as used for entry)
    pub fn validate_ticket(
        ctx: Context<ValidateTicket>,
    ) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        let event = &ctx.accounts.event;
        
        // Only event validator can validate tickets
        require!(
            ctx.accounts.validator.key() == event.validator_key,
            TicketError::UnauthorizedValidator
        );
        
        // Check ticket is valid and not already used
        require!(
            ticket.status == TicketStatus::Valid,
            TicketError::InvalidTicket
        );
        
        // Verify ownership
        require!(
            ctx.accounts.ticket_token_account.amount == 1,
            TicketError::NotOwner
        );
        
        // Mark as used
        ticket.status = TicketStatus::Used;
        ticket.used_at = Some(Clock::get()?.unix_timestamp);
        ticket.validated_by = Some(ctx.accounts.validator.key());
        
        emit!(TicketValidated {
            ticket_mint: ticket.ticket_mint,
            event_id: event.event_id.clone(),
            owner: ticket.owner,
            validator: ctx.accounts.validator.key(),
        });
        
        Ok(())
    }

    /// Transfer ticket ownership
    pub fn transfer_ticket(
        ctx: Context<TransferTicket>,
        transfer_price: Option<u64>,
    ) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        let ticket_type = &ctx.accounts.ticket_type;
        
        // Check if ticket is transferable
        require!(ticket_type.transferable, TicketError::NotTransferable);
        
        // Transfer NFT
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.from.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, 1)?;
        
        // Update ticket ownership
        ticket.owner = ctx.accounts.to.key();
        
        // Record transfer
        let transfer_record = &mut ctx.accounts.transfer_record;
        transfer_record.ticket_mint = ticket.ticket_mint;
        transfer_record.from = ctx.accounts.from.key();
        transfer_record.to = ctx.accounts.to.key();
        transfer_record.price = transfer_price;
        transfer_record.timestamp = Clock::get()?.unix_timestamp;
        
        emit!(TicketTransferred {
            ticket_mint: ticket.ticket_mint,
            from: ctx.accounts.from.key(),
            to: ctx.accounts.to.key(),
            price: transfer_price,
        });
        
        Ok(())
    }

    /// Emergency revoke ticket (admin only)
    pub fn revoke_ticket(
        ctx: Context<RevokeTicket>,
        reason: String,
    ) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        let event = &ctx.accounts.event;
        
        // Only event organizer can revoke
        require!(
            ctx.accounts.authority.key() == event.organizer,
            TicketError::UnauthorizedRevoke
        );
        
        ticket.status = TicketStatus::Revoked;
        ticket.revoked_at = Some(Clock::get()?.unix_timestamp);
        ticket.revoke_reason = Some(reason.clone());
        
        emit!(TicketRevoked {
            ticket_mint: ticket.ticket_mint,
            event_id: event.event_id.clone(),
            reason,
        });
        
        Ok(())
    }
}
```

### Account Structures (`tickettoken/contracts/programs/ticket-minter/src/state.rs`)

```rust
use anchor_lang::prelude::*;

#[account]
pub struct Event {
    pub event_id: String,           // Max 50 chars - 4 + 50 = 54 bytes
    pub organizer: Pubkey,          // 32 bytes
    pub title: String,              // Max 100 chars - 4 + 100 = 104 bytes
    pub capacity: u32,              // 4 bytes
    pub start_time: i64,            // 8 bytes
    pub end_time: i64,              // 8 bytes
    pub status: EventStatus,        // 1 byte
    pub validator_key: Pubkey,      // 32 bytes
    pub total_tickets_sold: u32,    // 4 bytes
    pub created_at: i64,            // 8 bytes
    pub bump: u8,                   // 1 byte
}
// Total: ~256 bytes + discriminator (8) = 264 bytes

#[account]
pub struct TicketType {
    pub ticket_type_id: String,     // Max 50 chars - 4 + 50 = 54 bytes
    pub event: Pubkey,              // 32 bytes
    pub name: String,               // Max 100 chars - 4 + 100 = 104 bytes
    pub price: u64,                 // 8 bytes
    pub currency: Currency,         // 1 byte
    pub max_supply: u32,            // 4 bytes
    pub current_supply: u32,        // 4 bytes
    pub sale_start: i64,            // 8 bytes
    pub sale_end: i64,              // 8 bytes
    pub transferable: bool,         // 1 byte
    pub resellable: bool,           // 1 byte
    pub is_active: bool,            // 1 byte
    pub created_at: i64,            // 8 bytes
    pub bump: u8,                   // 1 byte
}
// Total: ~235 bytes + discriminator = 243 bytes

#[account]
pub struct Ticket {
    pub ticket_mint: Pubkey,        // 32 bytes
    pub event: Pubkey,              // 32 bytes
    pub ticket_type: Pubkey,        // 32 bytes
    pub owner: Pubkey,              // 32 bytes
    pub purchase_price: u64,        // 8 bytes
    pub currency: Currency,         // 1 byte
    pub status: TicketStatus,       // 1 byte
    pub metadata: TicketMetadata,   // Variable size
    pub created_at: i64,            // 8 bytes
    pub used_at: Option<i64>,       // 1 + 8 = 9 bytes
    pub validated_by: Option<Pubkey>, // 1 + 32 = 33 bytes
    pub revoked_at: Option<i64>,    // 1 + 8 = 9 bytes
    pub revoke_reason: Option<String>, // Variable size
    pub bump: u8,                   // 1 byte
}

#[account]
pub struct TransferRecord {
    pub ticket_mint: Pubkey,        // 32 bytes
    pub from: Pubkey,               // 32 bytes
    pub to: Pubkey,                 // 32 bytes
    pub price: Option<u64>,         // 1 + 8 = 9 bytes
    pub timestamp: i64,             // 8 bytes
}
// Total: ~113 bytes + discriminator = 121 bytes

// Enums and embedded structs
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EventStatus {
    Active,
    Paused,
    Ended,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Currency {
    SOL,
    USDC,
    TICKET, // Platform token
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum TicketStatus {
    Valid,
    Used,
    Expired,
    Revoked,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TicketMetadata {
    pub name: String,               // Max 100 chars
    pub description: String,        // Max 500 chars
    pub image: String,              // IPFS hash - Max 100 chars
    pub external_url: Option<String>, // Optional website link
    pub attributes: Vec<TicketAttribute>, // Custom attributes
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TicketAttribute {
    pub trait_type: String,         // e.g., "seat", "section"
    pub value: String,              // e.g., "A1", "VIP"
}
```

### Context Structures (`tickettoken/contracts/programs/ticket-minter/src/contexts.rs`)

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct CreateEvent<'info> {
    #[account(
        init,
        payer = organizer,
        space = 8 + 264, // discriminator + Event struct
        seeds = [b"event", event_id.as_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,
    
    #[account(mut)]
    pub organizer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticket_type_id: String)]
pub struct CreateTicketType<'info> {
    #[account(
        init,
        payer = organizer,
        space = 8 + 400, // discriminator + TicketType struct
        seeds = [b"ticket_type", event.key().as_ref(), ticket_type_id.as_bytes()],
        bump
    )]
    pub ticket_type: Account<'info, TicketType>,
    
    #[account(
        constraint = event.organizer == organizer.key()
    )]
    pub event: Account<'info, Event>,
    
    #[account(mut)]
    pub organizer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintTicket<'info> {
    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = event,
        mint::freeze_authority = event,
    )]
    pub ticket_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = buyer,
        space = 8 + 1000, // discriminator + Ticket struct (estimated)
        seeds = [b"ticket", ticket_mint.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    
    #[account(
        init,
        payer = buyer,
        associated_token::mint = ticket_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub ticket_type: Account<'info, TicketType>,
    
    pub event: Account<'info, Event>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ValidateTicket<'info> {
    #[account(
        mut,
        constraint = ticket.ticket_mint == ticket_mint.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    pub ticket_mint: Account<'info, Mint>,
    
    #[account(
        constraint = ticket_token_account.mint == ticket_mint.key(),
        constraint = ticket_token_account.amount == 1
    )]
    pub ticket_token_account: Account<'info, TokenAccount>,
    
    pub event: Account<'info, Event>,
    
    pub validator: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferTicket<'info> {
    #[account(
        mut,
        constraint = ticket.ticket_mint == ticket_mint.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    pub ticket_type: Account<'info, TicketType>,
    
    pub ticket_mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = from_token_account.mint == ticket_mint.key(),
        constraint = from_token_account.owner == from.key(),
        constraint = from_token_account.amount == 1
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init_if_needed,
        payer = from,
        associated_token::mint = ticket_mint,
        associated_token::authority = to,
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = from,
        space = 8 + 121, // discriminator + TransferRecord struct
        seeds = [b"transfer", ticket_mint.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub transfer_record: Account<'info, TransferRecord>,
    
    #[account(mut)]
    pub from: Signer<'info>,
    
    /// CHECK: This is the recipient of the transfer
    pub to: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RevokeTicket<'info> {
    #[account(
        mut,
        constraint = ticket.ticket_mint == ticket_mint.key()
    )]
    pub ticket: Account<'info, Ticket>,
    
    pub ticket_mint: Account<'info, Mint>,
    
    pub event: Account<'info, Event>,
    
    pub authority: Signer<'info>,
}
```

### Events (`tickettoken/contracts/programs/ticket-minter/src/events.rs`)

```rust
use anchor_lang::prelude::*;

#[event]
pub struct EventCreated {
    pub event_id: String,
    pub organizer: Pubkey,
    pub capacity: u32,
}

#[event]
pub struct TicketMinted {
    pub ticket_mint: Pubkey,
    pub event_id: String,
    pub owner: Pubkey,
    pub price: u64,
}

#[event]
pub struct TicketValidated {
    pub ticket_mint: Pubkey,
    pub event_id: String,
    pub owner: Pubkey,
    pub validator: Pubkey,
}

#[event]
pub struct TicketTransferred {
    pub ticket_mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub price: Option<u64>,
}

#[event]
pub struct TicketRevoked {
    pub ticket_mint: Pubkey,
    pub event_id: String,
    pub reason: String,
}
```

### Errors (`tickettoken/contracts/programs/ticket-minter/src/error.rs`)

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum TicketError {
    #[msg("Sale is not currently active")]
    SaleNotActive,
    
    #[msg("Tickets are sold out")]
    SoldOut,
    
    #[msg("Unauthorized validator")]
    UnauthorizedValidator,
    
    #[msg("Invalid ticket")]
    InvalidTicket,
    
    #[msg("Not the ticket owner")]
    NotOwner,
    
    #[msg("Ticket is not transferable")]
    NotTransferable,
    
    #[msg("Unauthorized to revoke ticket")]
    UnauthorizedRevoke,
    
    #[msg("Event not found")]
    EventNotFound,
    
    #[msg("Ticket type not found")]
    TicketTypeNotFound,
    
    #[msg("Invalid event status")]
    InvalidEventStatus,
    
    #[msg("Event has already ended")]
    EventEnded,
    
    #[msg("Insufficient funds")]
    InsufficientFunds,
    
    #[msg("Invalid metadata")]
    InvalidMetadata,
}
```

## Usage Examples

### Creating an Event

```typescript
// tickettoken/contracts/app/src/ticket-minter.ts
import { Program, AnchorProvider, web3 } from "@project-serum/anchor";
import { TicketMinter } from "../target/types/ticket_minter";

const program = new Program<TicketMinter>(idl, programId, provider);

const eventId = "concert-2024-001";
const [eventPDA] = await web3.PublicKey.findProgramAddress(
  [Buffer.from("event"), Buffer.from(eventId)],
  program.programId
);

await program.methods
  .createEvent(
    eventId,
    "Summer Music Festival 2024",
    10000, // capacity
    new BN(1703721600), // start time
    new BN(1703808000), // end time
    validatorPublicKey
  )
  .accounts({
    event: eventPDA,
    organizer: organizer.publicKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .signers([organizer])
  .rpc();
```

### Minting a Ticket

```typescript
const ticketMint = web3.Keypair.generate();
const ticketMetadata = {
  name: "VIP Access - Summer Festival",
  description: "Premium VIP access with backstage privileges",
  image: "https://ipfs.io/ipfs/QmXxX...",
  externalUrl: null,
  attributes: [
    { traitType: "section", value: "VIP" },
    { traitType: "access_level", value: "Premium" }
  ]
};

await program.methods
  .mintTicket(ticketMetadata)
  .accounts({
    ticketMint: ticketMint.publicKey,
    ticket: ticketPDA,
    buyerTokenAccount: buyerTokenAccount,
    ticketType: ticketTypePDA,
    event: eventPDA,
    buyer: buyer.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: web3.SystemProgram.programId,
    rent: web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([buyer, ticketMint])
  .rpc();
```

## Security Considerations

1. **Access Control**: Only authorized parties can perform sensitive operations
2. **Ownership Verification**: All ticket operations verify NFT ownership
3. **Temporal Validation**: Sale periods and event times are enforced
4. **Supply Limits**: Maximum supply constraints are maintained
5. **Emergency Controls**: Organizers can revoke tickets if necessary

## Testing

Tests are located in `tickettoken/contracts/tests/ticket-minter.ts`

```bash
cd tickettoken/contracts
anchor test
```

## Deployment

Deploy to different networks:

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

---

*This documentation covers the core Ticket Minter program. Additional programs (Marketplace, Governance, Staking) follow similar patterns and will be documented separately.*
