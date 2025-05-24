use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
#[instruction(event_id: String)]
pub struct MintTicket<'info> {
    #[account(
        mut,
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = program_state,
    )]
    pub ticket_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + TicketData::LEN,
        seeds = [b"ticket_data", ticket_mint.key().as_ref()],
        bump,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = ticket_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: Recipient of the ticket
    pub recipient: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<MintTicket>,
    event_id: String,
    ticket_type: TicketType,
    metadata: TicketMetadata,
    transfer_restrictions: TransferRestrictions,
    content_access: Vec<ContentAccess>,
    royalty_recipients: Vec<RoyaltyRecipient>,
) -> Result<()> {
    let program_state = &mut ctx.accounts.program_state;
    let ticket_data = &mut ctx.accounts.ticket_data;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(event_id.len() <= 64, TicketTokenError::InvalidEventId);
    require!(metadata.name.len() <= 32, TicketTokenError::InvalidMetadata);
    require!(royalty_recipients.len() <= 5, TicketTokenError::TooManyRoyaltyRecipients);
    
    // Validate royalty percentages sum to 100%
    let total_royalty: u16 = royalty_recipients.iter().map(|r| r.percentage_bps).sum();
    require!(total_royalty == 10000, TicketTokenError::InvalidRoyaltyPercentage);
    
    // Initialize ticket data
    ticket_data.mint = ctx.accounts.ticket_mint.key();
    ticket_data.owner = ctx.accounts.recipient.key();
    ticket_data.original_owner = ctx.accounts.recipient.key();
    ticket_data.event_id = event_id;
    ticket_data.ticket_type = ticket_type;
    ticket_data.metadata = metadata;
    ticket_data.transfer_restrictions = transfer_restrictions;
    ticket_data.content_access = content_access;
    ticket_data.royalty_recipients = royalty_recipients;
    ticket_data.is_used = false;
    ticket_data.is_listed = false;
    ticket_data.mint_timestamp = Clock::get()?.unix_timestamp;
    ticket_data.usage_timestamp = None;
    ticket_data.transfer_count = 0;
    ticket_data.bump = *ctx.bumps.get("ticket_data").unwrap();
    
    // Mint the token
    let cpi_accounts = MintTo {
        mint: ctx.accounts.ticket_mint.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.program_state.to_account_info(),
    };
    
    let authority_seeds = &[
        b"program_state",
        &[program_state.bump],
    ];
    let signer = &[&authority_seeds[..]];
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::mint_to(cpi_ctx, 1)?;
    
    // Update program state
    program_state.total_tickets_minted = program_state.total_tickets_minted
        .checked_add(1)
        .ok_or(TicketTokenError::ArithmeticOverflow)?;
    
    emit!(TicketMinted {
        mint: ctx.accounts.ticket_mint.key(),
        owner: ctx.accounts.recipient.key(),
        event_id: ticket_data.event_id.clone(),
        ticket_type: ticket_data.ticket_type.clone(),
        timestamp: ticket_data.mint_timestamp,
    });
    
    msg!("Ticket minted successfully for event: {}", ticket_data.event_id);
    Ok(())
}
