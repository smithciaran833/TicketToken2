use anchor_lang::prelude::*;
use crate::state::{VoteType};

#[account]
pub struct Vote {
    /// The proposal this vote is for
    pub proposal: Pubkey,
    
    /// The voter who cast this vote
    pub voter: Pubkey,
    
    /// The type of vote cast
    pub vote_type: VoteType,
    
    /// The voting weight used for this vote
    pub weight: u64,
    
    /// When the vote was cast
    pub voted_at: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl Vote {
    pub const LEN: usize = 8 + // discriminator
        32 + // proposal
        32 + // voter
        1 + // vote_type
        8 + // weight
        8 + // voted_at
        1; // bump
}

#[account]
pub struct VoteDelegation {
    /// The governance account this delegation belongs to
    pub governance: Pubkey,
    
    /// The account delegating their votes
    pub delegator: Pubkey,
    
    /// The account receiving the delegated votes
    pub delegate: Pubkey,
    
    /// When the delegation was created
    pub delegated_at: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl VoteDelegation {
    pub const LEN: usize = 8 + // discriminator
        32 + // governance
        32 + // delegator
        32 + // delegate
        8 + // delegated_at
        1; // bump
}
