use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct GovernanceConfig {
    /// Minimum number of tokens required to create a proposal
    pub proposal_threshold: u64,
    
    /// Minimum percentage of total supply that must vote for proposal to be valid (in basis points)
    pub quorum_threshold_bps: u16,
    
    /// Minimum percentage of votes that must be "yes" for proposal to pass (in basis points)
    pub approval_threshold_bps: u16,
    
    /// Duration of voting period in seconds
    pub voting_duration: i64,
    
    /// Duration after proposal passes during which it can be executed
    pub execution_window: i64,
    
    /// Cool down period between proposals from the same user
    pub proposal_cooldown: i64,
}

impl Default for GovernanceConfig {
    fn default() -> Self {
        Self {
            proposal_threshold: 1000, // 1000 tokens minimum
            quorum_threshold_bps: 500, // 5% of total supply must vote
            approval_threshold_bps: 5000, // 50% approval required
            voting_duration: 7 * 24 * 60 * 60, // 7 days
            execution_window: 3 * 24 * 60 * 60, // 3 days to execute
            proposal_cooldown: 24 * 60 * 60, // 1 day cooldown
        }
    }
}

#[account]
pub struct Governance {
    /// Authority that can update governance parameters
    pub authority: Pubkey,
    
    /// The governance token mint
    pub governance_token_mint: Pubkey,
    
    /// Current governance configuration
    pub config: GovernanceConfig,
    
    /// Total number of proposals created
    pub proposal_count: u64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl Governance {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // governance_token_mint
        (8 + 2 + 2 + 8 + 8 + 8) + // config
        8 + // proposal_count
        1; // bump
        
    pub fn is_valid_quorum(&self, total_votes: u64, total_supply: u64) -> bool {
        let required_quorum = (total_supply as u128)
            .checked_mul(self.config.quorum_threshold_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;
            
        total_votes >= required_quorum
    }
    
    pub fn is_proposal_approved(&self, yes_votes: u64, total_votes: u64) -> bool {
        if total_votes == 0 {
            return false;
        }
        
        let approval_percentage = (yes_votes as u128)
            .checked_mul(10000)
            .unwrap()
            .checked_div(total_votes as u128)
            .unwrap() as u16;
            
        approval_percentage >= self.config.approval_threshold_bps
    }
}

#[account]
pub struct VoterWeight {
    /// The governance account this voter weight belongs to
    pub governance: Pubkey,
    
    /// The voter account
    pub voter: Pubkey,
    
    /// Current voting weight (can be delegated)
    pub weight: u64,
    
    /// If votes are delegated, this is the delegate
    pub delegate: Option<Pubkey>,
    
    /// If this account is a delegate, this tracks delegated weight
    pub delegated_weight: u64,
    
    /// Last time this voter created a proposal (for cooldown)
    pub last_proposal_time: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl VoterWeight {
    pub const LEN: usize = 8 + // discriminator
        32 + // governance
        32 + // voter
        8 + // weight
        (1 + 32) + // delegate (Option<Pubkey>)
        8 + // delegated_weight
        8 + // last_proposal_time
        1; // bump
        
    pub fn effective_weight(&self) -> u64 {
        self.weight + self.delegated_weight
    }
}
