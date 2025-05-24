use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct TransferTicket<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
        constraint = ticket_data.owner == current_owner.key() @ TicketTokenError::NotTicketOwner,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(
        mut,
        constraint = current_owner_token_account.mint == ticket_data.mint @ TicketTokenError::TicketMintMismatch,
        constraint = current_owner_token_account.owner == current_owner.key() @ TicketTokenError::TokenAccountMismatch,
    )]
    pub current_owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = new_owner_token_account.mint == ticket_data.mint @ TicketTokenError::TicketMintMismatch,
        constraint = new_owner_token_account.owner == new_owner.key() @ TicketTokenError::TokenAccountMismatch,
    )]
    pub new_owner_token_account: Account<'info, TokenAccount>,

    pub current_owner: Signer<'info>,

    /// CHECK: New owner of the ticket
    pub new_owner: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<TransferTicket>,
    transfer_type: TransferType,
) -> Result<()> {
    let ticket_data = &mut ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(!ticket_data.is_used, TicketTokenError::TicketAlreadyUsed);
    require!(!ticket_data.is_listed, TicketTokenError::TicketCurrentlyListed);
    
    // Check transfer restrictions
    match ticket_data.transfer_restrictions.transfer_type {
        AllowedTransferType::NoTransfer => {
            return Err(TicketTokenError::TransferNotAllowed.into());
        }
        AllowedTransferType::OwnerOnly => {
            require!(
                ctx.accounts.current_owner.key() == ticket_data.original_owner,
                TicketTokenError::TransferNotAllowed
            );
        }
        AllowedTransferType::RestrictedTransfer => {
            // Check if recipient is in allowed list
            if let Some(allowed_recipients) = &ticket_data.transfer_restrictions.allowed_recipients {
                require!(
                    allowed_recipients.contains(&ctx.accounts.new_owner.key()),
                    TicketTokenError::RecipientNotAllowed
                );
            }
        }
        AllowedTransferType::FreeTransfer => {
            // No restrictions
        }
    }
    
    // Check transfer limits
    if let Some(max_transfers) = ticket_data.transfer_restrictions.max_transfers {
        require!(
            ticket_data.transfer_count < max_transfers,
            TicketTokenError::TransferLimitExceeded
        );
    }
    
    // Perform the transfer
    let cpi_accounts = Transfer {
        from: ctx.accounts.current_owner_token_account.to_account_info(),
        to: ctx.accounts.new_owner_token_account.to_account_info(),
        authority: ctx.accounts.current_owner.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, 1)?;
    
    // Update ticket data
    ticket_data.owner = ctx.accounts.new_owner.key();
    ticket_data.transfer_count = ticket_data.transfer_count
        .checked_add(1)
        .ok_or(TicketTokenError::ArithmeticOverflow)?;
    
    emit!(TicketTransferred {
        mint: ticket_data.mint,
        from: ctx.accounts.current_owner.key(),
        to: ctx.accounts.new_owner.key(),
        transfer_type,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!("Ticket transferred successfully");
    Ok(())
}
