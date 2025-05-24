use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct DistributeRoyalty<'info> {
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        seeds = [b"ticket_data", ticket_data.mint.as_ref()],
        bump = ticket_data.bump,
    )]
    pub ticket_data: Account<'info, TicketData>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Royalty recipient account
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<DistributeRoyalty>,
    sale_amount: u64,
) -> Result<()> {
    let ticket_data = &ctx.accounts.ticket_data;
    let program_state = &ctx.accounts.program_state;
    
    require!(!program_state.is_paused, TicketTokenError::ProgramPaused);
    require!(sale_amount > 0, TicketTokenError::InvalidRefundAmount);
    
    // Find the recipient in the royalty recipients list
    let royalty_recipient = ticket_data.royalty_recipients
        .iter()
        .find(|r| r.recipient == ctx.accounts.recipient.key())
        .ok_or(TicketTokenError::Unauthorized)?;
    
    // Calculate royalty amount
    let royalty_amount = (sale_amount as u128)
        .checked_mul(royalty_recipient.percentage_bps as u128)
        .and_then(|amount| amount.checked_div(10000))
        .and_then(|amount| u64::try_from(amount).ok())
        .ok_or(TicketTokenError::ArithmeticOverflow)?;
    
    require!(royalty_amount > 0, TicketTokenError::InvalidRefundAmount);
    
    // Transfer royalty to recipient
    let transfer_to_recipient = system_program::Transfer {
        from: ctx.accounts.payer.to_account_info(),
        to: ctx.accounts.recipient.to_account_info(),
    };
    
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_to_recipient,
        ),
        royalty_amount,
    )?;
    
    emit!(RoyaltyDistributed {
        mint: ticket_data.mint,
        sale_amount,
        recipient: ctx.accounts.recipient.key(),
        royalty_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    msg!(
        "Royalty of {} lamports distributed to {} for role: {}",
        royalty_amount,
        ctx.accounts.recipient.key(),
        royalty_recipient.role
    );
    
    Ok(())
}
