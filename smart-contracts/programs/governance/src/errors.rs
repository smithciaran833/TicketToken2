use anchor_lang::prelude::*;

#[error_code]
pub enum GovernanceError {
    #[msg("Invalid governance authority")]
    InvalidAuthority,
    
    #[msg("Proposal is not in the correct state for this operation")]
    InvalidProposalState,
    
    #[msg("Voting period has ended")]
    VotingEnded,
    
    #[msg("Voting period has not started yet")]
    VotingNotStarted,
    
    #[msg("Proposal has not reached the execution threshold")]
    ExecutionThresholdNotMet,
    
    #[msg("Proposal execution period has expired")]
    ExecutionPeriodExpired,
    
    #[msg("User has already voted on this proposal")]
    AlreadyVoted,
    
    #[msg("Insufficient voting power")]
    InsufficientVotingPower,
    
    #[msg("Invalid vote weight")]
    InvalidVoteWeight,
    
    #[msg("Proposal title too long")]
    TitleTooLong,
    
    #[msg("Proposal description too long")]
    DescriptionTooLong,
    
    #[msg("Invalid proposal duration")]
    InvalidProposalDuration,
    
    #[msg("Cannot delegate votes to yourself")]
    SelfDelegation,
    
    #[msg("Invalid delegation")]
    InvalidDelegation,
    
    #[msg("Arithmetic overflow")]
    MathOverflow,
    
    #[msg("Cannot cancel an executed proposal")]
    CannotCancelExecuted,
    
    #[msg("Only proposal creator or governance authority can cancel")]
    UnauthorizedCancel,
    
    #[msg("Invalid quorum threshold")]
    InvalidQuorum,
    
    #[msg("Invalid execution instructions")]
    InvalidExecutionInstructions,
}
