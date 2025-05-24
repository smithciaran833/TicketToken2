use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalType {
    /// General governance proposal
    General,
    /// Event-specific proposal (voting by event ticket holders)
    Event,
    /// Platform configuration change
    Configuration,
    /// Treasury/fund management proposal
    Treasury,
    /// Emergency proposal (shorter voting period)
    Emergency,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalState {
    /// Proposal is active and accepting votes
    Active,
    /// Proposal passed and is awaiting execution
    Succeeded,
    /// Proposal was executed successfully
    Executed,
    /// Proposal was defeated (did not meet approval threshold)
    Defeated,
    /// Proposal was canceled
    Canceled,
    /// Proposal execution period expired
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VoteType {
    Yes,
    No,
    Abstain,
}

#[account]
pub struct Proposal {
    /// The governance account this proposal belongs to
    pub governance: Pubkey,
    
    /// Proposal ID (sequential number)
    pub id: u64,
    
    /// Address of the proposal creator
    pub proposer: Pubkey,
    
    /// Type of proposal
    pub proposal_type: ProposalType,
    
    /// Current state of the proposal
    pub state: ProposalState,
    
    /// Proposal title (max 64 characters)
    pub title: String,
    
    /// Proposal description (max 500 characters)
    pub description: String,
    
    /// Instructions to execute if proposal passes
    pub execution_instructions: Vec<u8>,
    
    /// When the proposal was created
    pub created_at: i64,
    
    /// When voting starts (usually same as created_at)
    pub voting_start_time: i64,
    
    /// When voting ends
    pub voting_end_time: i64,
    
    /// When the proposal can be executed (after voting ends)
    pub execution_start_time: i64,
    
    /// Last time the proposal can be executed
    pub execution_end_time: i64,
    
    /// Total number of yes votes
    pub yes_votes: u64,
    
    /// Total number of no votes
    pub no_votes: u64,
    
    /// Total number of abstain votes
    pub abstain_votes: u64,
    
    /// Total voting weight that has voted
    pub total_votes: u64,
    
    /// Number of unique voters
    pub voter_count: u32,
    
    /// For event-specific proposals, the event this relates to
    pub related_event: Option<Pubkey>,
    
    /// Bump seed for PDA
    pub bump: u8,
}

impl Proposal {
    pub const MAX_TITLE_LEN: usize = 64;
    pub const MAX_DESCRIPTION_LEN: usize = 500;
    pub const MAX_EXECUTION_INSTRUCTIONS_LEN: usize = 1000;
    
    pub const LEN: usize = 8 + // discriminator
        32 + // governance
        8 + // id
        32 + // proposer
        1 + // proposal_type
        1 + // state
        (4 + Self::MAX_TITLE_LEN) + // title
        (4 + Self::MAX_DESCRIPTION_LEN) + // description
        (4 + Self::MAX_EXECUTION_INSTRUCTIONS_LEN) + // execution_instructions
        8 + // created_at
        8 + // voting_start_time
        8 + // voting_end_time
        8 + // execution_start_time
        8 + // execution_end_time
        8 + // yes_votes
        8 + // no_votes
        8 + // abstain_votes
        8 + // total_votes
        4 + // voter_count
        (1 + 32) + // related_event (Option<Pubkey>)
        1; // bump
    
    pub fn is_active(&self, current_time: i64) -> bool {
        self.state == ProposalState::Active &&
        current_time >= self.voting_start_time &&
        current_time <= self.voting_end_time
    }
    
    pub fn can_be_executed(&self, current_time: i64) -> bool {
        self.state == ProposalState::Succeeded &&
        current_time >= self.execution_start_time &&
        current_time <= self.execution_end_time
    }
    
    pub fn update_state(&mut self, governance: &Governance, current_time: i64, total_supply: u64) {
        match self.state {
            ProposalState::Active => {
                if current_time > self.voting_end_time {
                    // Voting has ended, determine outcome
                    let quorum_met = governance.is_valid_quorum(self.total_votes, total_supply);
                    let approved = governance.is_proposal_approved(self.yes_votes, self.total_votes);
                    
                    if quorum_met && approved {
                        self.state = ProposalState::Succeeded;
                    } else {
                        self.state = ProposalState::Defeated;
                    }
                }
            },
            ProposalState::Succeeded => {
                if current_time > self.execution_end_time {
                    self.state = ProposalState::Expired;
                }
            },
            _ => {} // Other states don't change automatically
        }
    }
    
    pub fn calculate_voting_power_for_type(&self, base_weight: u64) -> u64 {
        match self.proposal_type {
            ProposalType::Emergency => base_weight * 2, // Emergency proposals have double weight
            _ => base_weight,
        }
    }
}
