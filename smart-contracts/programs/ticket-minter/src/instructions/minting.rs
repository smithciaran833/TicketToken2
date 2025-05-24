use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use solana_program::program::invoke_signed;
use mpl_token_metadata::{
    instruction::{create_metadata_accounts_v3, create_master_edition_v3},
    state::{DataV2, Creator},
    ID as TOKEN_METADATA_ID,
};

use crate::{Event, TicketType, Ticket, TicketStatus, TicketAttribute, TicketError};

/// Mints a new ticket NFT
pub fn mint_ticket(
    ctx: Context<crate::MintTicket>,
    metadata_uri: String,
    custom_attributes: Option<Vec<TicketAttribute>>,
) -> Result<()> {
    let event = &ctx.accounts.event;
    let ticket_type = &mut ctx.accounts.ticket_type;
    let ticket = &mut ctx.accounts.ticket;
    let mint = &ctx.accounts.mint;
    let buyer = &ctx.accounts.buyer;
    
    // Check if event is active
    if !event.active {
        return err!(TicketError::EventInactive);
    }
    
    // Check if ticket type is active
    if !ticket_type.active {
        return err!(TicketError::TicketTypeInactive);
    }
    
    // Check if tickets are available for this type
    if ticket_type.sold >= ticket_type.quantity {
        return err!(TicketError::TicketTypeSoldOut);
    }
    
    // Check if event has reached max capacity
    if event.tickets_issued >= event.max_tickets {
        return err!(TicketError::EventAtCapacity);
    }
    
    // Check payment (simplified - you may want to handle different payment tokens)
    if ticket_type.price > 0 {
        // Transfer payment from buyer to organizer
        let transfer_ix = solana_program::system_instruction::transfer(
            &buyer.key(),
            &ctx.accounts.organizer.key(),
            ticket_type.price,
        );
        
        solana_program::program::invoke(
            &transfer_ix,
            &[
                buyer.to_account_info(),
                ctx.accounts.organizer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }
    
    // Mint the NFT to buyer's token account
    let mint_authority_bump = *ctx.bumps.get("ticket_mint_authority").unwrap();
    let mint_authority_seeds = &[
        b"ticket_authority",
        mint.key().as_ref(),
        &[mint_authority_bump],
    ];
    let signer = &[&mint_authority_seeds[..]];
    
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.ticket_mint_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::mint_to(cpi_ctx, 1)?;
    
    // Create metadata account
    let ticket_name = format!("{} - {}", event.name, ticket_type.name);
    let ticket_symbol = event.symbol.clone();
    
    // Prepare creators array (event organizer gets royalties)
    let creators = vec![Creator {
        address: event.organizer,
        verified: false,
        share: 100,
    }];
    
    // Create metadata
    let metadata_infos = vec![
        ctx.accounts.metadata_account.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.ticket_mint_authority.to_account_info(),
        buyer.to_account_info(),
        ctx.accounts.token_metadata_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ];
    
    let metadata_ix = create_metadata_accounts_v3(
        TOKEN_METADATA_ID,
        ctx.accounts.metadata_account.key(),
        ctx.accounts.mint.key(),
        ctx.accounts.ticket_mint_authority.key(),
        buyer.key(),
        ctx.accounts.ticket_mint_authority.key(),
        ticket_name.clone(),
        ticket_symbol,
        metadata_uri.clone(),
        Some(creators),
        event.royalty_basis_points,
        true, // update_authority_is_signer
        true, // is_mutable
        None, // collection
        None, // uses
        None, // collection_details
    );
    
    invoke_signed(&metadata_ix, &metadata_infos, signer)?;
    
    // Create master edition
    let master_edition_infos = vec![
        ctx.accounts.master_edition.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.ticket_mint_authority.to_account_info(),
        ctx.accounts.ticket_mint_authority.to_account_info(),
        buyer.to_account_info(),
        ctx.accounts.metadata_account.to_account_info(),
        ctx.accounts.token_metadata_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
    ];
    
    let master_edition_ix = create_master_edition_v3(
        TOKEN_METADATA_ID,
        ctx.accounts.master_edition.key(),
        ctx.accounts.mint.key(),
        ctx.accounts.ticket_mint_authority.key(),
        ctx.accounts.ticket_mint_authority.key(),
        ctx.accounts.metadata_account.key(),
        buyer.key(),
        Some(0), // max_supply (0 = unlimited)
    );
    
    invoke_signed(&master_edition_ix, &master_edition_infos, signer)?;
    
    // Initialize ticket account
    let current_time = Clock::get()?.unix_timestamp;
    ticket.mint = mint.key();
    ticket.event = event.key();
    ticket.ticket_type = ticket_type.key();
    ticket.owner = buyer.key();
    ticket.serial_number = ticket_type.sold + 1;
    ticket.metadata_uri = metadata_uri;
    ticket.status = TicketStatus::Valid;
    ticket.transferable = true; // Can be changed later by organizer
    ticket.used_at = None;
    ticket.custom_attributes = custom_attributes.unwrap_or_default();
    ticket.bump = *ctx.bumps.get("ticket").unwrap();
    
    // Update counts
    ticket_type.sold += 1;
    let event_mut = &mut ctx.accounts.event;
    event_mut.tickets_issued += 1;
    
    msg!(
        "Minted ticket #{} for event {} to {}",
        ticket.serial_number,
        event.name,
        buyer.key()
    );
    
    Ok(())
}
