use anchor_lang::prelude::*;

/// Structure representing a single royalty recipient with their share
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RoyaltyRecipient {
    /// The public key of the recipient
    pub recipient: Pubkey,
    
    /// The basis points (1/100 of a percent) this recipient receives
    /// e.g., 500 = 5%
    pub basis_points: u16,
}

/// Structure representing multiple royalty recipients and distribution rules
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RoyaltyConfig {
    /// Array of royalty recipients
    pub recipients: Vec<RoyaltyRecipient>,
    
    /// Whether to apply tiered rates based on sale price
    pub tiered_rates: bool,
    
    /// If true, the basis points will be adjusted based on the secondary sale price
    /// For example, higher value sales might pay higher royalty percentages
    pub tier_thresholds: Option<Vec<u64>>,
    pub tier_basis_points_adjustments: Option<Vec<i16>>,
}

impl RoyaltyConfig {
    /// Calculate the total royalty basis points
    pub fn total_basis_points(&self) -> Result<u16> {
        let mut total: u16 = 0;
        for recipient in &self.recipients {
            total = total.checked_add(recipient.basis_points)
                .ok_or(ErrorCode::Overflow)?;
        }
        
        // Ensure total is not greater than 100%
        require!(total <= 10000, ErrorCode::InvalidRoyaltyConfig);
        
        Ok(total)
    }
    
    /// Calculate the effective royalty basis points based on sale price
    pub fn effective_basis_points(&self, sale_price: u64) -> Result<u16> {
        let base_bps = self.total_basis_points()?;
        
        // If not using tiered rates, return the base rate
        if !self.tiered_rates || self.tier_thresholds.is_none() || self.tier_basis_points_adjustments.is_none() {
            return Ok(base_bps);
        }
        
        let thresholds = self.tier_thresholds.as_ref().unwrap();
        let adjustments = self.tier_basis_points_adjustments.as_ref().unwrap();
        
        // Find the appropriate tier based on sale price
        let mut adjustment: i16 = 0;
        for i in 0..thresholds.len() {
            if i < adjustments.len() && sale_price >= thresholds[i] {
                adjustment = adjustments[i];
            }
        }
        
        // Apply the adjustment
        if adjustment >= 0 {
            base_bps.checked_add(adjustment as u16)
                .ok_or(ErrorCode::Overflow)
        } else {
            base_bps.checked_sub((-adjustment) as u16)
                .ok_or(ErrorCode::Overflow)
        }
    }
    
    /// Distribute royalties to all recipients
    pub fn distribute_royalties<'info>(
        &self,
        from: &AccountInfo<'info>,
        recipient_accounts: &[AccountInfo<'info>],
        system_program: &Program<'info, System>,
        sale_price: u64,
        signer_seeds: &[&[&[u8]]]
    ) -> Result<u64> {
        // Validate inputs
        require!(
            recipient_accounts.len() == self.recipients.len(),
            ErrorCode::InvalidRoyaltyRecipients
        );
        
        // Calculate the effective royalty rate
        let effective_bps = self.effective_basis_points(sale_price)?;
        
        // Calculate the total royalty amount
        let total_royalty = (sale_price as u128)
            .checked_mul(effective_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;
            
        // If total is zero, nothing to distribute
        if total_royalty == 0 {
            return Ok(0);
        }
        
        // Calculate each recipient's share and distribute
        let mut total_distributed: u64 = 0;
        
        for (i, recipient_info) in self.recipients.iter().enumerate() {
            // Calculate this recipient's share
            let recipient_share = (sale_price as u128)
                .checked_mul(recipient_info.basis_points as u128)
                .unwrap()
                .checked_div(10000)
                .unwrap() as u64;
                
            // If share is zero, skip this recipient
            if recipient_share == 0 {
                continue;
            }
            
            // Validate recipient account matches the expected recipient
            let recipient_account = &recipient_accounts[i];
            require!(
                recipient_account.key() == recipient_info.recipient,
                ErrorCode::InvalidRoyaltyRecipient
            );
            
            // Transfer funds to this recipient
            let transfer_ix = anchor_lang::system_program::Transfer {
                from: from.clone(),
                to: recipient_account.clone(),
            };
            
            let transfer_ctx = if signer_seeds.is_empty() {
                CpiContext::new(
                    system_program.to_account_info(),
                    transfer_ix,
                )
            } else {
                CpiContext::new_with_signer(
                    system_program.to_account_info(),
                    transfer_ix,
                    signer_seeds,
                )
            };
            
            anchor_lang::system_program::transfer(transfer_ctx, recipient_share)?;
            
            total_distributed = total_distributed.checked_add(recipient_share)
                .ok_or(ErrorCode::Overflow)?;
        }
        
        Ok(total_distributed)
    }
}
